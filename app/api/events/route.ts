import { NextRequest, NextResponse } from 'next/server';
import { getSupabaseAdmin } from '@/lib/supabase';

// POST /api/events
// Insert learning analytics events into learning_events table
export async function POST(request: NextRequest) {
  try {
    const { sessionId, articleId, eventType, payload } = await request.json();

    if (!eventType) {
      return NextResponse.json({ error: 'eventType is required' }, { status: 400 });
    }

    const supabase = getSupabaseAdmin();
    if (!supabase) {
      // No DB configured — silently accept
      return NextResponse.json({ ok: true });
    }

    await supabase.from('learning_events').insert({
      user_id: 'yaofang',
      session_id: sessionId || null,
      article_id: articleId || null,
      event_type: eventType,
      payload: payload || {},
    });

    return NextResponse.json({ ok: true });
  } catch {
    // Never fail — analytics should not break anything
    return NextResponse.json({ ok: true });
  }
}
