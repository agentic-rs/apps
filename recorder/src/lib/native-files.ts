import type { DirectoryEntry } from '@apell/sdk';

type ListPage = { entries: DirectoryEntry[]; next_cursor?: string | null };
type ListCall = (params: Record<string, unknown>) => Promise<ListPage>;

/** Keep pagination available when this applet is built with an older SDK. */
export async function listNativeFiles(
  call: ListCall,
  path = '',
): Promise<{ entries: DirectoryEntry[] }> {
  const entries: DirectoryEntry[] = [];
  const seen = new Set<string>();
  let cursor: string | undefined;
  for (;;) {
    let page: ListPage;
    try {
      page = await call({ path, page_size: 1000, ...(cursor === undefined ? {} : { cursor }) });
    } catch (error) {
      if (
        cursor === undefined &&
        error instanceof Error &&
        error.message === 'Invalid filesystem request parameters.'
      )
        return call({ path });
      throw error;
    }
    entries.push(...page.entries);
    if (page.next_cursor == null) return { entries };
    if (
      typeof page.next_cursor !== 'string' ||
      !page.next_cursor ||
      page.entries[page.entries.length - 1]?.name !== page.next_cursor ||
      seen.has(page.next_cursor)
    )
      throw new Error('The host returned an invalid directory cursor.');
    seen.add(page.next_cursor);
    cursor = page.next_cursor;
  }
}
