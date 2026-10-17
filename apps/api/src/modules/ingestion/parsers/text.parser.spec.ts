import { describe, expect, it } from 'vitest';

import { parseText } from './text.parser';

describe('parseText', () => {
  it('splits plain text on blank lines without headings', () => {
    expect(parseText('First paragraph.\nStill first.\n\nSecond paragraph.\n')).toEqual([
      { text: 'First paragraph.\nStill first.' },
      { text: 'Second paragraph.' },
    ]);
  });

  it('turns markdown headings into block headings', () => {
    expect(
      parseText('# Reset\nReset your password.\n\n## Billing\nInvoices are monthly.\n', {
        markdown: true,
      }),
    ).toEqual([
      { text: 'Reset', heading: 'Reset' },
      { text: 'Reset your password.', heading: 'Reset' },
      { text: 'Billing', heading: 'Billing' },
      { text: 'Invoices are monthly.', heading: 'Billing' },
    ]);
  });

  it('ignores empty input and blank-only lines', () => {
    expect(parseText('   \n\n \n')).toEqual([]);
  });
});
