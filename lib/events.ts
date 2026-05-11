// Learning analytics event logger
// Single user (yaofang), non-blocking, fire-and-forget

let _sessionId: string | null = null;

function getSessionId(): string {
  if (!_sessionId) {
    _sessionId = crypto.randomUUID();
  }
  return _sessionId;
}

export function resetSession() {
  _sessionId = null;
}

export function currentSessionId(): string {
  return getSessionId();
}

export type EventType =
  // Session lifecycle
  | 'session_start'
  | 'session_complete'
  | 'stage_enter'
  | 'stage_complete'
  // Video engagement
  | 'video_play'
  | 'video_pause'
  | 'video_replay'
  | 'video_complete'
  // Script step — vocabulary
  | 'word_click'
  | 'word_select'
  | 'word_deselect'
  | 'false_friend_seen'
  | 'sentence_read_time'
  | 'grammar_analyze'
  | 'grammar_select'
  | 'level_toggle'
  // Quiz
  | 'quiz_answer'
  | 'quiz_complete'
  // Shadowing
  | 'shadowing_record'
  | 'shadowing_score'
  | 'shadowing_complete'
  // Report
  | 'report_generated';

export function logEvent(
  eventType: EventType,
  payload: Record<string, unknown> = {},
  articleId?: string
) {
  try {
    const body = {
      sessionId: getSessionId(),
      articleId: articleId || null,
      eventType,
      payload,
    };

    // Fire-and-forget — never block the UI
    fetch('/api/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).catch(() => {
      // Silent failure — analytics never breaks UX
    });
  } catch {
    // Silent failure
  }
}
