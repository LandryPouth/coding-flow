"use strict";

// The words of test code, read the same way whatever a formatter did to them
// (story 19-08). A lexer, not a parser: it knows comments, strings and numbers
// well enough that prettier, gofmt, black or `eslint --fix` output reads as the
// code it came from, and nothing more.
//
// - Comments are dropped: `//`, `#` (at a line start or after a space, never
//   `#[` or `#!`), `/* … */` across lines, and a line starting with `*` (the
//   inside of a block comment whose opener lies outside a diff hunk).
// - Strings, docstrings and template text are STRING tokens, unescaped and
//   quote-free, so `'it\'s'` equals `"it's"`; a string that is a valid
//   identifier equals that identifier (`{'a': 1}` equals `{ a: 1 }`). The code
//   inside `${…}` is code.
// - Numbers are canonical: `.5` is `0.5`, `1E5` is `1e5`, `0XAB` is `0xab`,
//   `1.50` is `1.5`, `1J` is `1j`.
// - Operators are one token per character (`x=-1` is `x = -1`), `=>` excepted.
// - Brackets, commas, semicolons and the words a formatter swaps
//   (`var`/`let`/`const`, `function` and `=>`) carry nothing.

const DROPPED = new Set(["var", "let", "const", "function", "=>"]);
const CODE_TOKEN = /=>|[A-Za-z_$][\w$]*|0[xX]\w+|(?:\d\w*(?:\.\d\w*)?|\.\d\w*)(?:(?<=[eE])[+-]\d\w*)?|[^\s\w()[\]{},;]/g;
const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;
const ESCAPES = { n: "\n", t: "\t", r: "\r" };

function canonicalNumber(raw) {
  const lower = raw.toLowerCase().replace(/_/g, "");
  const radix = lower.match(/^(0[xob][0-9a-f]+)([a-z]*)$/);

  if (radix) {
    try {
      return `${BigInt(radix[1])}${radix[2]}`;
    } catch {
      return lower;
    }
  }

  const decimal = lower.match(/^([\d.]+(?:e[+-]?\d+)?)([a-z]*)$/);
  const value = decimal ? Number(decimal[1]) : NaN;
  return Number.isFinite(value) ? `${value}${decimal[2]}` : lower;
}

function stringToken(raw) {
  const text = raw.replace(/\\(.)/g, (match, char) => ESCAPES[char] ?? char);
  return { text: IDENTIFIER.test(text) ? text : JSON.stringify(text), string: true };
}

// Each line's code (comments removed, every string replaced by `""`) and every
// token, in order. State crosses lines: block comments, triple-quoted strings
// and template literals.
function lex(lines) {
  const state = { tokens: [], stack: [{ mode: "code", depth: 0 }], comment: false, triple: null, code: "", segment: "" };
  const codeLines = lines.map((line) => lexLine(state, line));
  return { tokens: state.tokens, codeLines };
}

function lexLine(state, line) {
  state.code = "";
  state.segment = "";
  state.noPartner = new Set();

  if (!state.comment && !state.triple && state.stack.length === 1 && /^\s*\*/.test(line)) {
    return "";
  }

  let index = 0;
  while (index < line.length) {
    const frame = state.stack[state.stack.length - 1];
    if (state.comment) index = stepComment(state, line, index);
    else if (state.triple) index = stepTriple(state, line, index);
    else if (frame.mode === "template") index = stepTemplate(state, frame, line, index);
    else index = stepCode(state, frame, line, index);
  }

  flush(state);
  const open = state.stack[state.stack.length - 1];
  if (open.mode === "template") open.text += "\n";
  return state.code;
}

// The code collected so far on this line, as tokens.
function flush(state) {
  for (const token of state.segment.match(CODE_TOKEN) || []) {
    if (!DROPPED.has(token)) state.tokens.push({ text: /^[\d.]/.test(token) ? canonicalNumber(token) : token, string: false });
  }
  state.code += state.segment;
  state.segment = "";
}

function closeString(state, raw) {
  flush(state);
  state.tokens.push(stringToken(raw));
  state.code += '""';
}

function stepComment(state, line, index) {
  const close = line.indexOf("*/", index);
  state.comment = close === -1;
  return state.comment ? line.length : close + 2;
}

function stepTriple(state, line, index) {
  const close = line.indexOf(state.triple.quote, index);
  if (close === -1) {
    state.triple.text += `${line.slice(index)}\n`;
    return line.length;
  }
  closeString(state, state.triple.text + line.slice(index, close));
  state.triple = null;
  return close + 3;
}

function stepTemplate(state, frame, line, index) {
  const char = line[index];
  if (char === "\\") {
    frame.text += line.slice(index, index + 2);
    return index + 2;
  }
  if (char === "`" || line.startsWith("${", index)) {
    if (frame.text) closeString(state, frame.text);
    frame.text = "";
    if (char === "`") state.stack.pop();
    else state.stack.push({ mode: "code", depth: 0 });
    return index + (char === "`" ? 1 : 2);
  }
  frame.text += char;
  return index + 1;
}

const isLineComment = (line, index) =>
  line.startsWith("//", index) || (line[index] === "#" && (index === 0 || /\s/.test(line[index - 1])) && !/[[!]/.test(line[index + 1] || ""));

// One step through code; returns the next index (the line's end at a comment).
function stepCode(state, frame, line, index) {
  const char = line[index];
  const inTemplate = state.stack.length > 1;
  const close = char === '"' || char === "'" ? closingQuote(state, line, index) : -1;

  if (isLineComment(line, index)) return line.length;
  if (line.startsWith('"""', index) || line.startsWith("'''", index) || line.startsWith("/*", index)) {
    flush(state);
    if (char === "/") state.comment = true;
    else state.triple = { quote: line.slice(index, index + 3), text: "" };
    return index + (char === "/" ? 2 : 3);
  }
  if (close !== -1) {
    closeString(state, line.slice(index + 1, close));
    return close + 1;
  }
  if (char === "`" || (inTemplate && char === "}" && frame.depth === 0)) {
    flush(state);
    if (char === "`") state.stack.push({ mode: "template", text: "" });
    else state.stack.pop();
    return index + 1;
  }
  if (inTemplate && char === "{") frame.depth += 1;
  if (inTemplate && char === "}") frame.depth -= 1;
  state.segment += char;
  return index + 1;
}

// The index of the quote closing the one at `start` on the same line, or -1:
// an apostrophe with no partner (`the user's access`) is not a string. Linear
// per line: once a quote kind has no partner from some point, no later quote
// of that kind has one either (the scan from the earlier quote passed the later
// one unescaped and went on from the same place), so it is not searched again.
function closingQuote(state, line, start) {
  const quote = line[start];
  if (state.noPartner.has(quote)) return -1;

  for (let index = start + 1; index < line.length; index += 1) {
    if (line[index] === "\\") index += 1;
    else if (line[index] === quote) return index;
  }

  state.noPartner.add(quote);
  return -1;
}

const tokensOf = (lines) => lex(lines).tokens;

// A multiset of token texts, consumed as added code is matched against removed code.
function bagOf(tokens) {
  const bag = new Map();
  for (const { text } of tokens) bag.set(text, (bag.get(text) || 0) + 1);
  return bag;
}

// Takes from `bag` every token it holds; returns the tokens it could not cover.
function consume(bag, tokens) {
  const left = [];

  for (const token of tokens) {
    const count = bag.get(token.text) || 0;
    if (count > 0) bag.set(token.text, count - 1);
    else left.push(token);
  }

  return left;
}

module.exports = { tokensOf, bagOf, consume };
