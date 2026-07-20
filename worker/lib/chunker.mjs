/**
 * Markdown-aware chunker for Obsidian vault files.
 *
 * Splits markdown documents into chunks that respect document structure:
 * - Splits on headings (H1-H3)
 * - Within sections, splits on paragraph boundaries (double newlines)
 * - Merges small adjacent chunks to reach target size
 * - Preserves heading hierarchy as metadata
 */

const TARGET_TOKENS = 400;
const MAX_TOKENS = 600;
// Rough approximation: 1 token ≈ 4 characters for English text
const CHARS_PER_TOKEN = 4;
const TARGET_CHARS = TARGET_TOKENS * CHARS_PER_TOKEN;
const MAX_CHARS = MAX_TOKENS * CHARS_PER_TOKEN;

/**
 * @typedef {Object} Chunk
 * @property {string} text - The chunk text content
 * @property {string} heading - Heading hierarchy (e.g., "Setup > Installation")
 * @property {number} lineStart - Starting line number in source file
 * @property {number} lineEnd - Ending line number in source file
 */

/**
 * Parse a markdown document into structured sections.
 * @param {string} content - Raw markdown content
 * @returns {Array<{heading: string, text: string, lineStart: number, lineEnd: number}>}
 */
function parseSections(content) {
  const lines = content.split('\n');
  const sections = [];
  const headingStack = []; // tracks H1 > H2 > H3 hierarchy

  let currentText = [];
  let sectionStart = 0;

  function flushSection(endLine) {
    const text = currentText.join('\n').trim();
    if (text.length > 0) {
      sections.push({
        heading: headingStack.join(' > '),
        text,
        lineStart: sectionStart,
        lineEnd: endLine,
      });
    }
    currentText = [];
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const headingMatch = line.match(/^(#{1,3})\s+(.+)/);

    if (headingMatch) {
      flushSection(i - 1);
      sectionStart = i;

      const level = headingMatch[1].length; // 1, 2, or 3
      const title = headingMatch[2].trim();

      // Pop stack to parent level, then push current heading
      while (headingStack.length >= level) {
        headingStack.pop();
      }
      headingStack.push(title);

      // Don't include the heading line itself in the chunk text
      // (it's captured in the heading metadata)
    } else {
      currentText.push(line);
    }
  }

  flushSection(lines.length - 1);
  return sections;
}

/**
 * Split a section into paragraph-level sub-chunks if it exceeds MAX_CHARS.
 * @param {Object} section
 * @returns {Array<Object>}
 */
function splitLargeSection(section) {
  if (section.text.length <= MAX_CHARS) {
    return [section];
  }

  // Split on double newlines (paragraph boundaries)
  const paragraphs = section.text.split(/\n\n+/);
  const chunks = [];
  let current = [];
  let currentLen = 0;
  let chunkStart = section.lineStart;

  for (const para of paragraphs) {
    const paraLen = para.length;

    if (currentLen + paraLen > MAX_CHARS && current.length > 0) {
      const text = current.join('\n\n').trim();
      const lineCount = text.split('\n').length;
      chunks.push({
        heading: section.heading,
        text,
        lineStart: chunkStart,
        lineEnd: chunkStart + lineCount - 1,
      });
      chunkStart = chunkStart + lineCount;
      current = [];
      currentLen = 0;
    }

    current.push(para);
    currentLen += paraLen + 2; // +2 for the \n\n separator
  }

  if (current.length > 0) {
    const text = current.join('\n\n').trim();
    chunks.push({
      heading: section.heading,
      text,
      lineStart: chunkStart,
      lineEnd: section.lineEnd,
    });
  }

  return chunks;
}

/**
 * Merge small adjacent chunks to reach TARGET_CHARS.
 * @param {Array<Object>} chunks
 * @returns {Array<Object>}
 */
function mergeSmallChunks(chunks) {
  if (chunks.length <= 1) return chunks;

  const merged = [];
  let current = null;

  for (const chunk of chunks) {
    if (!current) {
      current = { ...chunk };
      continue;
    }

    // Merge if both are small and share the same heading prefix
    if (
      current.text.length + chunk.text.length < TARGET_CHARS &&
      chunk.heading.startsWith(current.heading.split(' > ')[0])
    ) {
      current.text = current.text + '\n\n' + chunk.text;
      current.lineEnd = chunk.lineEnd;
      if (chunk.heading.length > current.heading.length) {
        current.heading = chunk.heading;
      }
    } else {
      merged.push(current);
      current = { ...chunk };
    }
  }

  if (current) merged.push(current);
  return merged;
}

/**
 * Strip frontmatter from markdown content.
 * @param {string} content
 * @returns {string}
 */
function stripFrontmatter(content) {
  if (content.startsWith('---')) {
    const endIndex = content.indexOf('---', 3);
    if (endIndex !== -1) {
      return content.slice(endIndex + 3).trim();
    }
  }
  return content;
}

/**
 * Chunk a markdown document into semantically meaningful pieces.
 * @param {string} content - Raw markdown file content
 * @param {string} filePath - Relative file path (for context)
 * @returns {Chunk[]}
 */
export function chunkMarkdown(content, filePath) {
  // Strip frontmatter — it's metadata, not content
  const cleaned = stripFrontmatter(content);

  if (cleaned.length === 0) return [];

  // If the file is tiny, return as single chunk
  if (cleaned.length <= TARGET_CHARS) {
    return [
      {
        text: cleaned,
        heading: '',
        lineStart: 0,
        lineEnd: cleaned.split('\n').length - 1,
      },
    ];
  }

  // Parse into heading-based sections
  const sections = parseSections(cleaned);

  // Split oversized sections
  const split = sections.flatMap(splitLargeSection);

  // Merge undersized chunks
  const merged = mergeSmallChunks(split);

  // Filter empty chunks
  return merged.filter((c) => c.text.trim().length > 0);
}
