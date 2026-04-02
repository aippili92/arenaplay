/**
 * ArenaPlay — Score Calculator
 * Trigger: On Request (REST endpoint)
 * Method: POST
 * Path: /score
 *
 * Called by FastAPI after the answer window closes for each round.
 * Computes per-player scores with a speed bonus.
 *
 * Why On Request and not Before/After Publish?
 *   Scoring is a BATCH operation — it needs ALL answers for the round, not a
 *   single message in flight. On Request is a REST endpoint that FastAPI calls
 *   explicitly after collecting answers. Before/After Publish runs per-message,
 *   which is the wrong granularity for aggregation.
 *
 * Call budget: 3 per execution. This function uses 0 external calls — pure JS math.
 *
 * Request body:
 * {
 *   "correctAnswer": "B",
 *   "answers": [
 *     {"playerId": "p-001", "answer": "B", "submittedAt": 1714920025000},
 *     {"playerId": "p-002", "answer": "A", "submittedAt": 1714920027000}
 *   ],
 *   "questionOpenedAt": 1714920000000,  // ms timestamp
 *   "timeLimit": 30
 * }
 *
 * Response:
 * {
 *   "scores": [
 *     {"playerId": "p-001", "correct": true, "base": 100, "speedBonus": 50, "total": 150},
 *     {"playerId": "p-002", "correct": false, "base": 0, "speedBonus": 0, "total": 0}
 *   ]
 * }
 */
export default async (request) => {
  const body = JSON.parse(request.params.body || '{}');
  const { correctAnswer, answers = [], questionOpenedAt, timeLimit = 30 } = body;

  if (!correctAnswer || !Array.isArray(answers)) {
    return request.respond({ status: 400, body: JSON.stringify({ error: 'Invalid input' }) });
  }

  // Separate correct answers and sort by submission time (earliest first)
  const correct = answers
    .filter((a) => a.answer === correctAnswer)
    .sort((a, b) => a.submittedAt - b.submittedAt);

  const timeWindowMs = timeLimit * 1000;

  const scores = answers.map((a) => {
    const isCorrect = a.answer === correctAnswer;
    if (!isCorrect) {
      return { playerId: a.playerId, correct: false, base: 0, speedBonus: 0, total: 0 };
    }

    // Speed bonus: linearly scale from 50 (instant) to 0 (at time limit)
    // Cap elapsed time to the time window so late answers don't get negative bonus.
    const elapsed = Math.min(a.submittedAt - questionOpenedAt, timeWindowMs);
    const fraction = 1 - elapsed / timeWindowMs; // 1.0 = instant, 0.0 = at limit
    const speedBonus = Math.round(fraction * 50);

    return {
      playerId: a.playerId,
      correct: true,
      base: 100,
      speedBonus,
      total: 100 + speedBonus,
    };
  });

  return request.respond({
    status: 200,
    body: JSON.stringify({ scores }),
  });
};
