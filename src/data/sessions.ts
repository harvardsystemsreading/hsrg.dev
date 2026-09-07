// Session schedule and past-talk embeds, rendered by src/pages/index.astro.
// Content preserved from the 2025-26 Notion site.

export interface Link { text: string; href: string }

export interface Session {
  /** Plain text, or text with one linked span (e.g. the company name) */
  topic: string | { before: string; link: Link; after?: string };
  /** Session material: a link, plain text such as "N/A", or nothing */
  material?: Link | string;
  lead: string | { before: string; link: Link; after?: string };
  date: string;   // MM/DD/YYYY, as shown
}

export const sessions: Session[] = [
  {
    topic: 'GPU Kernel Programming',
    material: { text: 'GPU_Kernel_Programming_HSRG.pdf', href: 'https://drive.google.com/file/d/1lp43CMwa4au7ITOxxqqC-GjcbaLIulkB/view?usp=sharing' },
    lead: 'Emmanuel Rassou',
    date: '02/07/2026',
  },
  {
    topic: { before: 'Modern Vision Systems (joined by ', link: { text: 'Etched', href: 'https://www.etched.com' }, after: ')' },
    material: { text: 'Modern_Vision_Systems_HSRG.pdf', href: 'https://drive.google.com/file/d/1OO9yLqoqE6VDPoWhpiVSjYprCIP4BJHG/view?usp=share_link' },
    lead: 'Anmay Gupta',
    date: '02/14/2026',
  },
  {
    topic: 'Linux OS (NixOS)',
    material: { text: 'ethancedwards.com', href: 'https://ethancedwards.com/latex/presentations/nixos/nixos.pdf' },
    lead: 'Ethan Edwards',
    date: '02/21/2026',
  },
  {
    topic: 'OSS inference stack by Robert Shaw from Red Hat',
    material: 'N/A',
    lead: 'SEAS Systems Seminar (partner)',
    date: '03/04/2026',
  },
  {
    topic: 'Processor Vulnerabilities',
    material: { text: 'HSRG_week_4_processor_vulnerabilities.pdf', href: 'https://drive.google.com/file/d/17x2cUPiRi9oyAnj7aEnzqPQV0P80707k/view?usp=sharing' },
    lead: 'Heorhii Ambartsumov',
    date: '03/07/2026',
  },
  {
    topic: 'The Collapse of Constrained Physical AI by Jason Jabbour',
    material: 'N/A',
    lead: 'SEAS Systems Seminar (partner)',
    date: '03/18/2026',
  },
  {
    topic: 'Privacy and data use policy enforcement by end-to-end privacy and data use policy enforcement by Malte Schwarzkopf',
    material: 'N/A',
    lead: 'SEAS Systems Seminar (partner)',
    date: '03/25/2026',
  },
  {
    topic: 'Hardware and Software Support for Model Alignment',
    material: 'N/A',
    lead: 'Dr James Mickens',
    date: '03/28/2026',
  },
  {
    topic: 'Sharding and Sparse Attention with MatX',
    material: 'N/A',
    lead: { before: 'Akshay Mishra & Sanjit Neelam (', link: { text: 'MatX', href: 'https://matx.com' }, after: ')' },
    date: '04/04/2026',
  },
  {
    topic: 'Scalable OS Infrastructure',
    material: { text: 'arxiv.org', href: 'https://arxiv.org/pdf/2511.11672' },
    lead: 'HSRG Board',
    date: '04/11/2026',
  },
  {
    topic: 'Virtual Private Networks',
    lead: 'Heorhii Ambartsumov',
    date: '04/18/2026',
  },
];

/** Google Drive previews shown under "Past talks". */
export const pastTalks: { title: string; driveId: string }[] = [
  { title: 'GPU Kernel Programming', driveId: '1lp43CMwa4au7ITOxxqqC-GjcbaLIulkB' },
  { title: 'Modern Vision Systems', driveId: '1OO9yLqoqE6VDPoWhpiVSjYprCIP4BJHG' },
  { title: 'Past talk 3', driveId: '1o-OevNk8ihz9mHPtW57YNJ3P-ZiQXpNa' },
  { title: 'Processor Vulnerabilities', driveId: '17x2cUPiRi9oyAnj7aEnzqPQV0P80707k' },
];
