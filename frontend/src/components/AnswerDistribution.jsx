import React, { useMemo } from 'react';

const LABELS = ['A', 'B', 'C', 'D'];

/**
 * Props:
 *   distribution – { A: count, B: count, C: count, D: count }
 *   correctAnswer – letter, shown on reveal
 *   revealed      – boolean
 */
export default function AnswerDistribution({ distribution = {}, correctAnswer, revealed }) {
  const total = useMemo(
    () => LABELS.reduce((sum, l) => sum + (distribution[l] || 0), 0),
    [distribution]
  );

  return (
    <div className="answer-dist">
      <h4 className="answer-dist-title">Live Responses</h4>
      {LABELS.map((letter) => {
        const count = distribution[letter] || 0;
        const pct = total > 0 ? Math.round((count / total) * 100) : 0;
        const isCorrect = revealed && letter === correctAnswer;
        return (
          <div key={letter} className="dist-row">
            <span className="dist-label">{letter}</span>
            <div className="dist-track">
              <div
                className={`dist-fill ${isCorrect ? 'dist-fill--correct' : ''}`}
                style={{ width: `${pct}%` }}
              />
            </div>
            <span className="dist-pct">{pct}%</span>
            <span className="dist-count">({count})</span>
          </div>
        );
      })}
      <p className="dist-total">{total} total responses</p>
    </div>
  );
}
