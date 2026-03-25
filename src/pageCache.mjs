import fs from 'fs/promises';
import { existsSync, mkdirSync } from 'fs';
import path from 'path';
import crypto from 'crypto';
import { inflateRawSync } from 'zlib';

const CACHE_DIR = path.resolve('data/cache');
if (!existsSync(CACHE_DIR)) mkdirSync(CACHE_DIR, { recursive: true });

function urlToFile(url) {
    const hash = crypto.createHash('md5').update(url).digest('hex');
    const ext = url.match(/\.(pdf|docx?)(\?|$)/i)?.[1]?.toLowerCase() || 'html';
    return path.join(CACHE_DIR, `${hash}.${ext}`);
}

export async function getCached(url) {
    const file = urlToFile(url);
    try { return await fs.readFile(file, 'utf-8'); } catch { return null; }
}

export async function getCachedBinary(url) {
    const file = urlToFile(url);
    try { return await fs.readFile(file); } catch { return null; }
}

export async function putCache(url, content) {
    await fs.writeFile(urlToFile(url), content);
}

export async function putCacheBinary(url, buffer) {
    await fs.writeFile(urlToFile(url), buffer);
}

/**
 * Extract text from a PDF buffer. Zero dependencies — reads the raw PDF
 * stream and extracts text between BT/ET operators and parenthesised strings.
 * Not perfect but works for most text-based PDFs.
 */
export function extractTextFromPDF(buffer) {
    const raw = buffer.toString('latin1');
    const texts = [];

    // Decompress FlateDecode streams
    const streamRegex = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
    let match;
    let allContent = raw;

    // Extract text from uncompressed content (parenthesised strings in BT..ET blocks)
    const btRegex = /BT\s([\s\S]*?)ET/g;
    while ((match = btRegex.exec(allContent)) !== null) {
        const block = match[1];
        const tjRegex = /\(([^)]*)\)\s*Tj|\[((?:[^]]*?))\]\s*TJ/g;
        let tj;
        while ((tj = tjRegex.exec(block)) !== null) {
            if (tj[1]) texts.push(tj[1]);
            if (tj[2]) {
                const parts = tj[2].match(/\(([^)]*)\)/g);
                if (parts) texts.push(parts.map(p => p.slice(1, -1)).join(''));
            }
        }
    }

    // Fallback: extract all parenthesised strings if BT/ET found nothing
    if (!texts.length) {
        const parenRegex = /\(([^)]{4,})\)/g;
        while ((match = parenRegex.exec(raw)) !== null) {
            const t = match[1].replace(/\\n/g, '\n').replace(/\\r/g, '').replace(/\\\(/g, '(').replace(/\\\)/g, ')');
            if (/[a-zA-Z]{3,}/.test(t)) texts.push(t);
        }
    }

    return texts.join(' ').replace(/\s+/g, ' ').trim();
}

/**
 * Extract text from a DOCX buffer. DOCX is a ZIP containing XML.
 * We find document.xml and strip tags. Zero dependencies — uses
 * the ZIP local file header format directly.
 */
export function extractTextFromDOCX(buffer) {
    // Find PK entries, look for word/document.xml
    const entries = [];
    let offset = 0;
    while (offset < buffer.length - 4) {
        if (buffer.readUInt32LE(offset) === 0x04034b50) { // Local file header
            const compMethod = buffer.readUInt16LE(offset + 8);
            const fnLen = buffer.readUInt16LE(offset + 26);
            const extraLen = buffer.readUInt16LE(offset + 28);
            const compSize = buffer.readUInt32LE(offset + 18);
            const filename = buffer.toString('utf8', offset + 30, offset + 30 + fnLen);
            const dataStart = offset + 30 + fnLen + extraLen;
            entries.push({ filename, compMethod, dataStart, compSize });
            offset = dataStart + compSize;
        } else {
            offset++;
        }
    }

    const docEntry = entries.find(e => e.filename === 'word/document.xml');
    if (!docEntry) return '';

    let xml;
    if (docEntry.compMethod === 0) {
        xml = buffer.toString('utf8', docEntry.dataStart, docEntry.dataStart + docEntry.compSize);
    } else {
        // Deflate — use built-in zlib
        try {
            xml = inflateRawSync(buffer.subarray(docEntry.dataStart, docEntry.dataStart + docEntry.compSize)).toString('utf8');
        } catch { return ''; }
    }

    // Strip XML tags, decode entities
    return xml
        .replace(/<w:br[^>]*\/>/g, '\n')
        .replace(/<\/w:p>/g, '\n')
        .replace(/<[^>]+>/g, '')
        .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
        .replace(/\s+/g, ' ').trim();
}
