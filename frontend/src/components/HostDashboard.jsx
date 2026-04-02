import React, { useState, useCallback, useMemo, useRef } from 'react';
import { ch, EventType } from '../channels.js';
import { usePubNubListener } from '../hooks/usePubNubListener.js';
import Leaderboard from './Leaderboard.jsx';
import AnswerDistribution from './AnswerDistribution.jsx';
import ChatPanel from './ChatPanel.jsx';
import PlayerCount from './PlayerCount.jsx';

/**
 * Host view: broadcast questions, track live answers, see leaderboard.
 */
export default function HostDashboard({ gameContext, onLeave }) {
  const { gameId, joinCode, pubnub, questions: initialQuestions } = gameContext;

  // Questions come from the initial game state, then stay fixed
  const [questions, setQuestions] = useState(initialQuestions || []);
  const [currentRound, setCurrentRound] = useState(0); // 0-indexed
  const [phase, setPhase] = useState('lobby'); // lobby | question | reveal | ended
  const [correctAnswer, setCorrectAnswer] = useState(null); // set on ANSWER_REVEAL
  const [distribution, setDistribution] = useState({ A: 0, B: 0, C: 0, D: 0 });
  const [leaderboard, setLeaderboard] = useState([]);
  const [chatMessages, setChatMessages] = useState([]);
  const [playerCount, setPlayerCount] = useState(0);
  const [crowdEnergy, setCrowdEnergy] = useState(0);
  const [actionLoading, setActionLoading] = useState(false);
  const [copySuccess, setCopySuccess] = useState(false);

  // Stable channel list ref to avoid listener churn
  const channels = useMemo(() => ch.hostChannels(gameId), [gameId]);

  const handleMessage = useCallback((event) => {
    const msg = event.message;
    if (!msg?.type) return;

    switch (msg.type) {
      case EventType.ANSWER_SUBMITTED: {
        const ans = msg.answer;
        if (ans && ['A', 'B', 'C', 'D'].includes(ans)) {
          setDistribution((prev) => ({ ...prev, [ans]: (prev[ans] || 0) + 1 }));
        }
        break;
      }
      case EventType.SCORES_UPDATED:
        if (Array.isArray(msg.leaderboard)) setLeaderboard(msg.leaderboard);
        break;
      case EventType.CHAT_MESSAGE:
        setChatMessages((prev) => [
          ...prev,
          { id: event.timetoken, displayName: msg.displayName, text: msg.text, sentAt: msg.sentAt },
        ]);
        break;
      case EventType.CROWD_ENERGY_UPDATE:
        if (typeof msg.energy === 'number') setCrowdEnergy(msg.energy);
        break;
      case EventType.REACTION_BURST:
        // Bump crowd energy by burst size
        if (Array.isArray(msg.reactions)) {
          const total = msg.reactions.reduce((s, r) => s + r.count, 0);
          setCrowdEnergy((prev) => Math.min(100, prev + total * 2));
        }
        break;
      case EventType.PLAYER_COUNT_UPDATE:
        if (typeof msg.count === 'number') setPlayerCount(msg.count);
        break;
      case EventType.GAME_ENDED:
        setPhase('ended');
        if (Array.isArray(msg.finalLeaderboard)) setLeaderboard(msg.finalLeaderboard);
        break;
      case EventType.QUESTION_BROADCAST:
        setPhase('question');
        setCorrectAnswer(null);
        setDistribution({ A: 0, B: 0, C: 0, D: 0 });
        if (typeof msg.roundNumber === 'number') setCurrentRound(msg.roundNumber);
        break;
      case EventType.ANSWER_REVEAL:
        setPhase('reveal');
        if (msg.correctAnswer) setCorrectAnswer(msg.correctAnswer);
        break;
      default:
        break;
    }
  }, []);

  usePubNubListener(pubnub, channels, handleMessage);

  // ── API helpers ───────────────────────────────────────────────
  async function apiPost(path, body = {}) {
    setActionLoading(true);
    try {
      const res = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        console.error('[Host] API error', path, data);
      }
      return await res.json().catch(() => ({}));
    } finally {
      setActionLoading(false);
    }
  }

  async function startAndBroadcast() {
    // First call /start to advance round and set current_question in game state
    await apiPost(`/api/games/${gameId}/start`);
    // Then broadcast the question to players via PubNub
    const data = await apiPost(`/api/games/${gameId}/question`);
    if (typeof data.roundNumber === 'number') setCurrentRound(data.roundNumber);
    setPhase('question');
    setCorrectAnswer(null);
    setDistribution({ A: 0, B: 0, C: 0, D: 0 });
  }

  async function revealAnswer() {
    await apiPost(`/api/games/${gameId}/reveal`);
    setPhase('reveal');
  }

  async function nextRound() {
    const data = await apiPost(`/api/games/${gameId}/next`);
    if (typeof data.round === 'number') setCurrentRound(data.round);
    setPhase('question');
    setCorrectAnswer(null);
    setDistribution({ A: 0, B: 0, C: 0, D: 0 });
  }

  async function endGame() {
    if (!window.confirm('End the game for all players?')) return;
    await apiPost(`/api/games/${gameId}/end`);
    setPhase('ended');
  }

  function copyJoinCode() {
    navigator.clipboard.writeText(joinCode || gameId).then(() => {
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000);
    });
  }

  const currentQ = questions[currentRound];
  const totalRounds = questions.length;

  return (
    <div className="host-layout">
      {/* ── Header ── */}
      <header className="host-header">
        <div className="host-header-left">
          <span className="header-logo">ArenaPlay</span>
          <span className="header-badge host-badge">HOST</span>
        </div>
        <div className="host-header-center">
          <span className="join-code-label">Join code:</span>
          <button className="join-code-display" onClick={copyJoinCode} title="Click to copy">
            {joinCode || gameId}
            <span className="copy-hint">{copySuccess ? '✓ Copied!' : 'copy'}</span>
          </button>
        </div>
        <div className="host-header-right">
          <PlayerCount count={playerCount} />
          <button className="btn-danger" onClick={onLeave}>
            End &amp; Exit
          </button>
        </div>
      </header>

      {/* ── Main ── */}
      <div className="host-main">
        {/* Left column: question controls + distribution */}
        <div className="host-col-main">
          {phase === 'lobby' && (
            <div className="card lobby-waiting">
              <h2>Waiting for players…</h2>
              <p className="text-muted">Share the game code above. When ready, broadcast the first question.</p>
              <button
                className="btn-primary"
                onClick={startAndBroadcast}
                disabled={actionLoading}
              >
                {actionLoading ? 'Starting…' : 'Start Game →'}
              </button>
            </div>
          )}

          {(phase === 'question' || phase === 'reveal') && currentQ && (
            <div className="host-question-area">
              <div className="round-indicator">
                Round {currentRound + 1} of {totalRounds}
              </div>
              <div className="card host-question-card">
                <p className="host-question-text">{currentQ.text}</p>
                <div className="host-options">
                  {currentQ.options?.map((opt, i) => {
                    const letter = ['A', 'B', 'C', 'D'][i];
                    const isCorrect = phase === 'reveal' && letter === correctAnswer;
                    return (
                      <div
                        key={letter}
                        className={`host-option ${isCorrect ? 'host-option--correct' : ''}`}
                      >
                        <span className="host-option-label">{letter}</span>
                        <span>{opt}</span>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="host-action-row">
                {phase === 'question' && (
                  <button
                    className="btn-primary"
                    onClick={revealAnswer}
                    disabled={actionLoading}
                  >
                    Reveal Answer
                  </button>
                )}
                {phase === 'reveal' && currentRound < totalRounds - 1 && (
                  <button
                    className="btn-primary"
                    onClick={nextRound}
                    disabled={actionLoading}
                  >
                    Next Round →
                  </button>
                )}
                {phase === 'reveal' && currentRound >= totalRounds - 1 && (
                  <button
                    className="btn-danger"
                    onClick={endGame}
                    disabled={actionLoading}
                  >
                    End Game
                  </button>
                )}
              </div>
            </div>
          )}

          {phase === 'ended' && (
            <div className="card lobby-waiting">
              <h2>Game Over!</h2>
              <p className="text-muted">Final results are in.</p>
              <button className="btn-primary" onClick={onLeave}>Back to Lobby</button>
            </div>
          )}

          {/* Live distribution always visible after game starts */}
          {(phase === 'question' || phase === 'reveal') && (
            <AnswerDistribution
              distribution={distribution}
              correctAnswer={phase === 'reveal' ? correctAnswer : undefined}
              revealed={phase === 'reveal'}
            />
          )}

          {/* Crowd energy */}
          <div className="card crowd-energy">
            <h4>Crowd Energy</h4>
            <div className="energy-track">
              <div
                className="energy-fill"
                style={{ width: `${crowdEnergy}%` }}
              />
            </div>
            <span className="energy-label">{crowdEnergy}%</span>
          </div>
        </div>

        {/* Right column: leaderboard + chat */}
        <div className="host-col-side">
          <Leaderboard players={leaderboard} highlightId={null} />
          <ChatPanel messages={chatMessages} canSend={false} />
        </div>
      </div>
    </div>
  );
}
