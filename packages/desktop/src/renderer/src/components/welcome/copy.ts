/**
 * Every string the welcome page shows, in one place — the copy deck from
 * `private-docs/welcome_page_spec/welcome-page.md`. Centralized so the voice
 * stays consistent and a copy edit is a one-file change, never a hunt through
 * five components.
 *
 * Voice: warm, concrete, no buzzwords, no third-party product names (other than
 * Claude Code, which is the agent we pair with). The page lands ONE idea and
 * offers TWO doors — it is not a manual.
 */
export const welcomeCopy = {
  wordmark: 'BaseHalf',
  returningHero: 'Welcome back.',

  thesis:
    'A spatial home for your files — notes, PDFs, images, all on one canvas. Open it beside your AI agent, and it sees what you’re looking at.',

  openFolder: 'Open a folder',
  openDemo: 'Open a demo',
  openDemoLink: 'Open a demo →',
  dropHint: 'or drop a folder anywhere',

  recentLabel: 'Recent',
  openMarker: 'Open',

  beats: [
    {
      title: 'Open a folder',
      body: 'your files appear as cards. Nothing moves.',
    },
    {
      title: 'Add context',
      body: 'write a line on a file, or link two together.',
    },
    {
      title: 'Open your AI beside it',
      body: 'it reads what you’re focused on and how things connect.',
    },
  ],

  disclosureSummary: 'What BaseHalf adds to a folder',

  footer:
    'Pair it with Claude Code — or any AI agent — on the other half of your screen. It reads what you’re focused on and how your files relate.',
} as const;
