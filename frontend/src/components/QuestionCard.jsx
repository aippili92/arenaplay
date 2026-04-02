import React from 'react';

const LABELS = ['A', 'B', 'C', 'D'];

/**
 * Props:
 *   question      – { id, text, options: string[], roundNumber, totalRounds }
 *   phase         – 'question' | 'reveal'
 *   selectedAnswer – letter (A/B/C/D) or null
 *   correctAnswer  – letter, only set on reveal phase
 *   onAnswer      – (letter) => void
 *   timeLeft      – number (seconds remaining)
 */
export default function QuestionCard({
  question,
  phase,
  selectedAnswer,
  correctAnswer,
  onAnswer,
  timeLeft,
}) {
  if (!question) return null;

  const totalTime = 30;
  const pct = Math.max(0, (timeLeft / totalTime) * 100);
  const timerCritical = timeLeft <= 5;
  const canAnswer = phase === 'question' && !selectedAnswer && timeLeft > 0;

  function getTileClass(letter) {
    const base = 'answer-tile';
    if (phase === 'reveal') {
      if (letter === correctAnswer) return `${base} answer-tile--correct`;
      if (letter === selectedAnswer) return `${base} answer-tile--wrong`;
      return `${base} answer-tile--dimmed`;
    }
    if (letter === selectedAnswer) return `${base} answer-tile--selected`;
    return base;
  }

  return (
    <div className="question-card card">
      {question.totalRounds && (
        <div className="question-round-label">
          Round {question.roundNumber} of {question.totalRounds}
        </div>
      )}

      {/* Countdown bar */}
      {phase === 'question' && (
        <div className="countdown-track">
          <div
            className={`countdown-fill ${timerCritical ? 'countdown-fill--critical' : ''}`}
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
      {phase === 'question' && (
        <div className={`countdown-label ${timerCritical ? 'countdown-label--critical' : ''}`}>
          {timeLeft}s
        </div>
      )}

      <p className="question-text">{question.text}</p>

      <div className="answer-grid">
        {question.options.map((option, i) => {
          const letter = LABELS[i];
          return (
            <button
              key={letter}
              className={getTileClass(letter)}
              onClick={() => canAnswer && onAnswer(letter)}
              disabled={!canAnswer}
              aria-label={`Answer ${letter}: ${option}`}
            >
              <span className="tile-label">{letter}</span>
              <span className="tile-text">{option}</span>
              {phase === 'reveal' && letter === correctAnswer && (
                <span className="tile-correct-mark">✓</span>
              )}
            </button>
          );
        })}
      </div>

      {phase === 'reveal' && selectedAnswer && (
        <div className={`reveal-feedback ${selectedAnswer === correctAnswer ? 'reveal-feedback--correct' : 'reveal-feedback--wrong'}`}>
          {selectedAnswer === correctAnswer ? '✓ Correct!' : '✗ Wrong answer'}
        </div>
      )}
      {phase === 'question' && !selectedAnswer && timeLeft === 0 && (
        <div className="reveal-feedback reveal-feedback--wrong">Time's up!</div>
      )}
    </div>
  );
}
