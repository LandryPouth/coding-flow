'use strict';

// Money is integer cents everywhere. Floats are never allowed to hold an amount.

function parseAmount(input) {
  if (typeof input === 'number') {
    if (!Number.isInteger(input)) {
      throw new Error('amount must be given in cents');
    }

    return input;
  }

  const match = String(input).trim().match(/^(-?)(\d+)(?:[.,](\d{1,2}))?$/);

  if (!match) {
    throw new Error(`cannot read amount: ${input}`);
  }

  const [, sign, whole, fraction = '0'] = match;
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));

  return sign === '-' ? -cents : cents;
}

function formatAmount(cents) {
  const whole = Math.trunc(cents / 100);
  const fraction = Math.abs(cents % 100);

  return `$${whole}.${String(fraction).padStart(2, '0')}`;
}

function sumCents(amounts) {
  return amounts.reduce((total, amount) => total + amount, 0);
}

module.exports = { parseAmount, formatAmount, sumCents };
