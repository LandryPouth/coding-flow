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
  const tokens = [];
  const codeLines = [];
  const stack = [{ mode: "code", depth: 0 }];
  let comment = false;
  let triple = null;

  for (const line of lines) {
    let code = "";
    let segment = "";
    const flush = () => {
      for (const token of segment.match(CODE_TOKEN) || []) {
        if (!DROPPED.has(token)) tokens.push({ text: /^[\d.]/.test(token) ? canonicalNumber(token) : token, string: false });
      }
      code += segment;
      segment = "";
    };
    const closeString = (raw) => {
      flush();
      tokens.push(stringToken(raw));
      code += '""';
    };

    if (!comment && !triple && stack.length === 1 && /^\s*\*/.test(line)) {
      codeLines.push("");
      continue;
    }

    let index = 0;
    while (index < line.length) {
      const frame = stack[stack.length - 1];
      const char = line[index];

      if (comment) {
        const close = line.indexOf("*/", index);
        comment = close === -1;
        index = comment ? line.length : close + 2;
      } else if (triple) {
        const close = line.indexOf(triple.quote, index);
        if (close === -1) {
          triple.text += `${line.slice(index)}\n`;
          index = line.length;
        } else {
          closeString(triple.text + line.slice(index, close));
          triple = null;
          index = close + 3;
        }
      } else if (frame.mode === "template") {
        if (char === "\\") {
          frame.text += line.slice(index, index + 2);
          index += 2;
        } else if (char === "`" || line.startsWith("${", index)) {
          if (frame.text) closeString(frame.text);
          frame.text = "";
          if (char === "`") stack.pop();
          else stack.push({ mode: "code", depth: 0 });
          index += char === "`" ? 1 : 2;
        } else {
          frame.text += char;
          index += 1;
        }
      } else if (line.startsWith("/*", index)) {
        flush();
        comment = true;
        index += 2;
      } else if (line.startsWith("//", index) || (char === "#" && (index === 0 || /\s/.test(line[index - 1])) && !/[[!]/.test(line[index + 1] || ""))) {
        break;
      } else if (line.startsWith('"""', index) || line.startsWith("'''", index)) {
        flush();
        triple = { quote: line.slice(index, index + 3), text: "" };
        index += 3;
      } else if ((char === '"' || char === "'") && closingQuote(line, index) !== -1) {
        const close = closingQuote(line, index);
        closeString(line.slice(index + 1, close));
        index = close + 1;
      } else if (char === "`") {
        flush();
        stack.push({ mode: "template", text: "" });
        index += 1;
      } else if (stack.length > 1 && char === "}" && frame.depth === 0) {
        flush();
        stack.pop();
        index += 1;
      } else {
        if (stack.length > 1 && char === "{") frame.depth += 1;
        if (stack.length > 1 && char === "}") frame.depth -= 1;
        segment += char;
        index += 1;
      }
    }

    flush();
    const open = stack[stack.length - 1];
    if (open.mode === "template") open.text += "\n";
    codeLines.push(code);
  }

  return { tokens, codeLines };
}

// The index of the quote closing the one at `start` on the same line, or -1:
// an apostrophe with no partner (`the user's access`) is not a string.
function closingQuote(line, start) {
  for (let index = start + 1; index < line.length; index += 1) {
    if (line[index] === "\\") index += 1;
    else if (line[index] === line[start]) return index;
  }
  return -1;
}

const tokensOf = (lines) => lex(lines).tokens;
const codeLinesOf = (lines) => lex(lines).codeLines;

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

module.exports = { tokensOf, codeLinesOf, bagOf, consume };
