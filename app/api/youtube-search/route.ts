import { NextRequest, NextResponse } from 'next/server';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const YouTube = require('youtube-search-api');

export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams.get('q');
  if (!q) {
    return NextResponse.json({ error: 'q parameter required' }, { status: 400 });
  }

  try {
    const results = await YouTube.GetListByKeyword(q, false, 20);
    const videos = (results.items || [])
      .filter((item: Record<string, unknown>) => item.type === 'video')
      .map((item: Record<string, unknown>) => {
        const duration = (item.length as Record<string, unknown>)?.simpleText as string || '0:00';
        const parts = duration.split(':').map(Number);
        let durationSeconds = 0;
        if (parts.length === 3) durationSeconds = parts[0] * 3600 + parts[1] * 60 + parts[2];
        else if (parts.length === 2) durationSeconds = parts[0] * 60 + parts[1];

        return {
          id: item.id as string,
          title: item.title as string,
          channel: (item.channelTitle as string) || '',
          duration,
          durationSeconds,
        };
      });

    return NextResponse.json({ videos });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Search failed', videos: [] },
      { status: 500 },
    );
  }
}
