import React, { useState } from 'react';

const SAMPLE_QUESTIONS = [
  {
    question_id: 'q1',
    text: 'What messaging pattern does PubNub use?',
    options: ['Request-Response', 'Pub/Sub', 'SOAP', 'GraphQL'],
    correct: 'B',
    time_limit: 30,
  },
  {
    question_id: 'q2',
    text: "What's the max PubNub message size?",
    options: ['1 KB', '8 KB', '32 KB', '64 KB'],
    correct: 'C',
    time_limit: 30,
  },
  {
    question_id: 'q3',
    text: 'Which company invented the transistor?',
    options: ['IBM', 'Bell Labs', 'Texas Instruments', 'Intel'],
    correct: 'B',
    time_limit: 30,
  },
  {
    question_id: 'q4',
    text: 'What does PAM stand for in PubNub?',
    options: [
      'Private Access Mode',
      'PubNub App Manager',
      'PubNub Access Manager',
      'Permission Auth Module',
    ],
    correct: 'C',
    time_limit: 30,
  },
  {
    question_id: 'q5',
    text: 'How many bytes max for a PubNub Signal?',
    options: ['32', '64', '128', '256'],
    correct: 'B',
    time_limit: 30,
  },
];

export default function JoinScreen({ userId, onHostCreate, onPlayerJoin }) {
  // Join form state
  const [joinCode, setJoinCode] = useState('');
  const [joinName, setJoinName] = useState('');
  const [joinLoading, setJoinLoading] = useState(false);
  const [joinError, setJoinError] = useState('');

  // Create form state
  const [hostName, setHostName] = useState('');
  const [useSampleQuestions, setUseSampleQuestions] = useState(true);
  const [customJson, setCustomJson] = useState('');
  const [createLoading, setCreateLoading] = useState(false);
  const [createError, setCreateError] = useState('');

  async function handleJoin(e) {
    e.preventDefault();
    if (!joinCode.trim() || !joinName.trim()) return;
    setJoinLoading(true);
    setJoinError('');
    const code = joinCode.trim().toUpperCase();
    try {
      const res = await fetch(`/api/games/${code}/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          join_code: code,
          display_name: joinName.trim(),
          player_id: userId,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail || `Failed to join (${res.status})`);
      }
      const data = await res.json();
      onPlayerJoin({
        gameId: data.gameState?.game_id || code,
        joinCode: code,
        playerId: data.playerId,
        displayName: joinName.trim(),
        token: data.playerToken,
      });
    } catch (err) {
      setJoinError(err.message);
    } finally {
      setJoinLoading(false);
    }
  }

  async function handleCreate(e) {
    e.preventDefault();
    if (!hostName.trim()) return;
    setCreateLoading(true);
    setCreateError('');
    let questions = SAMPLE_QUESTIONS;
    if (!useSampleQuestions) {
      try {
        questions = JSON.parse(customJson);
      } catch {
        setCreateError('Invalid JSON — check your questions format.');
        setCreateLoading(false);
        return;
      }
    }
    try {
      const res = await fetch('/api/games/', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          host_id: userId,
          host_display_name: hostName.trim(),
          questions,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail || `Failed to create game (${res.status})`);
      }
      const data = await res.json();
      onHostCreate({
        gameId: data.gameId,
        joinCode: data.joinCode,
        displayName: hostName.trim(),
        token: data.hostToken,
        questions: data.gameState?.questions || questions,
      });
    } catch (err) {
      setCreateError(err.message);
    } finally {
      setCreateLoading(false);
    }
  }

  return (
    <div className="join-screen">
      <div className="join-hero">
        <div className="join-logo">
          <span className="logo-arena">Arena</span>
          <span className="logo-play">Play</span>
        </div>
        <p className="join-tagline">Live multiplayer trivia — real-time, every answer counts.</p>
      </div>

      <div className="join-panels">
        {/* ── Join a game ── */}
        <div className="card join-panel">
          <h2 className="panel-title">Join a Game</h2>
          <p className="panel-sub">Enter the code your host shared</p>
          <form onSubmit={handleJoin} className="join-form">
            <div className="field">
              <label htmlFor="joinCode">Game Code</label>
              <input
                id="joinCode"
                className="input join-code-input"
                type="text"
                maxLength={6}
                placeholder="ABC123"
                value={joinCode}
                onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                autoComplete="off"
              />
            </div>
            <div className="field">
              <label htmlFor="joinName">Your Name</label>
              <input
                id="joinName"
                className="input"
                type="text"
                maxLength={24}
                placeholder="Player name"
                value={joinName}
                onChange={(e) => setJoinName(e.target.value)}
              />
            </div>
            {joinError && <p className="form-error">{joinError}</p>}
            <button
              type="submit"
              className="btn-primary btn-full"
              disabled={joinLoading || !joinCode.trim() || !joinName.trim()}
            >
              {joinLoading ? 'Joining...' : 'Join Game →'}
            </button>
          </form>
        </div>

        <div className="join-divider">
          <span>or</span>
        </div>

        {/* ── Create a game ── */}
        <div className="card join-panel">
          <h2 className="panel-title">Host a Game</h2>
          <p className="panel-sub">Create a new game and invite players</p>
          <form onSubmit={handleCreate} className="join-form">
            <div className="field">
              <label htmlFor="hostName">Your Name</label>
              <input
                id="hostName"
                className="input"
                type="text"
                maxLength={24}
                placeholder="Host name"
                value={hostName}
                onChange={(e) => setHostName(e.target.value)}
              />
            </div>
            <div className="field">
              <label className="toggle-label">
                <input
                  type="checkbox"
                  checked={useSampleQuestions}
                  onChange={(e) => setUseSampleQuestions(e.target.checked)}
                />
                <span>Use sample PubNub trivia questions</span>
              </label>
            </div>
            {!useSampleQuestions && (
              <div className="field">
                <label htmlFor="customJson">Questions (JSON)</label>
                <textarea
                  id="customJson"
                  className="input textarea"
                  rows={6}
                  placeholder={'[{"text":"Q?","options":["A","B","C","D"],"answer":"A"}]'}
                  value={customJson}
                  onChange={(e) => setCustomJson(e.target.value)}
                />
              </div>
            )}
            {useSampleQuestions && (
              <div className="sample-questions-preview">
                <p className="preview-label">5 questions loaded:</p>
                {SAMPLE_QUESTIONS.map((q, i) => (
                  <div key={i} className="preview-q">
                    <span className="preview-num">Q{i + 1}</span>
                    <span className="preview-text">{q.text}</span>
                    <span className="preview-answer">Ans: {q.correct}</span>
                  </div>
                ))}
              </div>
            )}
            {createError && <p className="form-error">{createError}</p>}
            <button
              type="submit"
              className="btn-primary btn-full btn-amber"
              disabled={createLoading || !hostName.trim()}
            >
              {createLoading ? 'Creating...' : 'Create Game ⚡'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
