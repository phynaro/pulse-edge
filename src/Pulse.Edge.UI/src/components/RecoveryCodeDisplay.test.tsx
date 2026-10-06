import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import RecoveryCodeDisplay from './RecoveryCodeDisplay';

const sampleCode = ['AAAA', 'BBBB', 'CCCC', 'DDDD', 'EEEE'].join('-');

describe('RecoveryCodeDisplay', () => {
  it('shows the code and only enables Continue once the user confirms saving it', async () => {
    const user = userEvent.setup();
    const onDone = vi.fn();
    render(<RecoveryCodeDisplay code={sampleCode} onDone={onDone} />);

    expect(screen.getByTestId('recovery-code')).toHaveTextContent(sampleCode);
    const proceed = screen.getByRole('button', { name: /continue/i });
    expect(proceed).toBeDisabled();

    await user.click(screen.getByLabelText(/i have saved this code/i));
    await user.click(proceed);

    expect(onDone).toHaveBeenCalledOnce();
  });
});
