import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { ch, EventType } from '../channels.js';
import { usePubNubListener } from '../hooks/usePubNubListener.js';
import QuestionCard from './QuestionCard.jsx';
import Leaderboard from './Leaderboard.jsx';
import ReactionStrip from './ReactionStrip.jsx';
import ChatPanel from './ChatPanel.jsx';
import PlayerCount from './PlayerCount.jsx';

/**
 * Player view state machine:
 *   lobby → question → reveal → (next question or ended)
 */
export default function PlayerGame({ gameContext, onLeave }) {
  const { gameId, playerId, displayName, pubnub } = gameContext;

  const [phase, setPhase] = useState('lobby');
  const [currentQuestion, setCurrentQuestion] = useState(null);
  const [selectedAnswer, setSelectedAnswer] = useState(null);
  const [correctAnswer, setCorrectAnswer] = useState(null);
  const [scoreDelta, setScoreDelta] = useState(null);
  const [leaderboard, setLeaderboard] = useState([]);
  const [chatMessages, setChatMessages] = useState([]);
  const [playerCount, setPlayerCount] = useState(0);
  const [timeLeft, setTimeLeft] = useState(30);
  const [showDelta, setShowDelta] = useState(false);

  const timerRef = useRef(null);

  function stopTimer() {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }

  function startTimer(seconds = 30) {
    stopTimer();
    setTimeLeft(seconds);
    timerRef.current = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          stopTimer();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }

  // Cleanup timer on unmount
  useEffect(() => () => stopTimer(), []);

  const channels = useMemo(() => ch.playerChannels(gameId, playerId), [gameId, playerId]);

  const handleMessage = useCallback((event) => {
    const msg = event.message;
    if (!msg?.type) return;

    switch (msg.type) {
      case EventType.GAME_STARTED:
        setPhase('lobby');
        break;

      case EventType.QUESTION_BROADCAST:
        setPhase('question');
        setSelectedAnswer(null);
        setCorrectAnswer(null);
        setScoreDelta(null);
        setShowDelta(false);
        setCurrentQuestion({
          id: msg.questionId,
          text: msg.text,
          options: msg.options,
          roundNumber: msg.roundNumber,
          totalRounds: msg.totalRounds,
          answer: null, // not revealed yet
        });
        startTimer(msg.timeLimit || 30);
        break;

      case EventType.ANSWER_REVEAL:
        stopTimer();
        setPhase('reveal');
        setCorrectAnswer(msg.correctAnswer);
        // Score delta comes via SCORES_UPDATED, but may arrive in same payload
        if (typeof msg.scoreDelta === 'number') {
          setScoreDelta(msg.scoreDelta);
          setShowDelta(true);
          setTimeout(() => setShowDelta(false), 3000);
        }
        break;

      case EventType.SCORES_UPDATED: {
        if (Array.isArray(msg.leaderboard)) setLeaderboard(msg.leaderboard);
        // Find this player's delta
        const me = msg.leaderboard?.find((p) => p.playerId === playerId);
        if (me?.delta) {
          setScoreDelta(me.delta);
          setShowDelta(true);
          setTimeout(() => setShowDelta(false), 3000);
        }
        break;
      }

      case EventType.CHAT_MESSAGE:
        setChatMessages((prev) => [
          ...prev,
          { id: event.timetoken, displayName: msg.displayName, text: msg.text, sentAt: msg.sentAt },
        ]);
        break;

      case EventType.PLAYER_JOINED:
      case EventType.CROWD_ENERGY_UPDATE:
        if (typeof msg.playerCount === 'number') setPlayerCount(msg.playerCount);
        break;

      case EventType.GAME_ENDED:
        stopTimer();
        setPhase('ended');
        if (Array.isArray(msg.leaderboard)) setLeaderboard(msg.leaderboard);
        break;

      default:
        break;
    }
  }, [playerId]);

  usePubNubListener(pubnub, channels, handleMessage);

  function submitAnswer(letter) {
    if (selectedAnswer || timeLeft === 0) return;
    setSelectedAnswer(letter);
    stopTimer();

    // Publish to PubNub (for live answer distribution display on host side)
    pubnub
      .publish({
        channel: ch.answersInbound(gameId),
        message: {
          type: EventType.ANSWER_SUBMITTED,
          gameId,
          playerId,
          displayName,
          questionId: currentQuestion?.id,
          roundNumber: currentQuestion?.roundNumber,
          answer: letter,
          submittedAt: Date.now(),
        },
      })
      .catch((err) => console.error('[Player] Answer publish failed:', err));

    // Record with backend for scoring
    fetch(`/api/games/${gameId}/answer`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        player_id: playerId,
        answer: letter,
        round_number: currentQuestion?.roundNumber ?? 0,
      }),
    }).catch((err) => console.error('[Player] Answer record failed:', err));
  }

  function sendChat(text) {
    pubnub
      .publish({
        channel: ch.chat(gameId),
        message: {
          type: EventType.CHAT_MESSAGE,
          gameId,
          playerId,
          displayName,
          text,
          sentAt: Date.now(),
        },
      })
      .catch((err) => console.error('[Player] Chat publish failed:', err));
  }

  const myRank = leaderboard.findIndex((p) => p.playerId === playerId) + 1;
  const myScore = leaderboard.find((p) => p.playerId === playerId)?.score ?? 0;

  return (
    <div className="player-layout">
      {/* ── Header ── */}
      <header className="player-header">
        <div className="player-header-left">
          <span className="header-logo">ArenaPlay</span>
        </div>
        <div className="player-header-center">
          <span className="player-name-badge">{displayName}</span>
          {myRank > 0 && (
            <span className="player-rank-badge">#{myRank}</span>
          )}
          <span className="player-score-badge">{myScore.toLocaleString()} pts</span>
        </div>
        <div className="player-header-right">
          <PlayerCount count={playerCount} />
          <button className="btn-ghost" onClick={onLeave}>Leave</button>
        </div>
      </header>

      {/* ── Body ── */}
      <div className="player-main">
        <div className="player-col-main">
          {/* Score delta popup */}
          {showDelta && scoreDelta !== null && (
            <div className={`score-delta-popup ${scoreDelta > 0 ? 'score-delta--positive' : 'score-delta--zero'}`}>
              {scoreDelta > 0 ? `+${scoreDelta}` : scoreDelta} pts
            </div>
          )}

          {phase === 'lobby' && (
            <div className="card lobby-waiting player-lobby">
              <div className="lobby-icon">🎮</div>
              <h2>You're in!</h2>
              <p className="text-muted">Waiting for the host to start the game…</p>
              <PlayerCount count={playerCount} />
            </div>
          )}

          {(phase === 'question' || phase === 'reveal') && (
            <>
              <QuestionCard
                question={currentQuestion}
                phase={phase}
                selectedAnswer={selectedAnswer}
                correctAnswer={correctAnswer}
                onAnswer={submitAnswer}
                timeLeft={timeLeft}
              />
              <ReactionStrip
                pubnubClient={pubnub}
                channel={ch.reactions(gameId)}
              />
            </>
          )}

          {phase === 'ended' && (
            <div className="card lobby-waiting player-ended">
              <div className="ended-icon">🏆</div>
              <h2>Game Over!</h2>
              {myRank > 0 && (
                <p className="ended-rank">
                  You finished <strong>#{myRank}</strong> with{' '}
                  <strong>{myScore.toLocaleString()} pts</strong>
                </p>
              )}
              <button className="btn-primary" onClick={onLeave}>
                Back to Lobby
              </button>
            </div>
          )}
        </div>

        {/* Side: leaderboard + chat */}
        <div className="player-col-side">
          <Leaderboard players={leaderboard} highlightId={playerId} />
          <ChatPanel messages={chatMessages} onSend={sendChat} canSend={true} />
        </div>
      </div>
    </div>
  );
}
