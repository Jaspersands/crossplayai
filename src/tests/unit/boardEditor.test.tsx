import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { BoardEditor } from '../../components/BoardEditor';
import { createEmptyBoard } from '../../lib/boardUtils';

describe('BoardEditor keyboard interactions', () => {
  it('replaces focused cell value when typing a letter', () => {
    const board = createEmptyBoard();
    const onCellChange = vi.fn();

    render(
      <BoardEditor
        board={board}
        lowConfidenceSet={new Set()}
        onCellChange={onCellChange}
      />,
    );

    const input = screen.getByLabelText('Cell 1-1');
    input.focus();
    fireEvent.keyDown(input, { key: 'q' });

    expect(onCellChange).toHaveBeenCalledWith(0, 0, 'Q', false);
    expect(input).toHaveFocus();
  });

  it('clears with backspace/delete while preserving blank toggle', () => {
    const board = createEmptyBoard();
    board[0][0] = { letter: 'A', isBlank: true };
    const onCellChange = vi.fn();

    render(
      <BoardEditor
        board={board}
        lowConfidenceSet={new Set()}
        onCellChange={onCellChange}
      />,
    );

    const input = screen.getByLabelText('Cell 1-1');
    input.focus();

    fireEvent.keyDown(input, { key: 'Backspace' });
    expect(onCellChange).toHaveBeenLastCalledWith(0, 0, '', true);

    fireEvent.keyDown(input, { key: 'Delete' });
    expect(onCellChange).toHaveBeenLastCalledWith(0, 0, '', true);
  });

  it('moves focus with arrow keys and clamps at board edges', () => {
    const board = createEmptyBoard();

    render(
      <BoardEditor
        board={board}
        lowConfidenceSet={new Set()}
        onCellChange={vi.fn()}
      />,
    );

    const cell11 = screen.getByLabelText('Cell 1-1');
    const cell12 = screen.getByLabelText('Cell 1-2');

    cell11.focus();
    fireEvent.keyDown(cell11, { key: 'ArrowRight' });
    expect(cell12).toHaveFocus();

    fireEvent.keyDown(cell12, { key: 'ArrowUp' });
    expect(cell12).toHaveFocus();

    fireEvent.keyDown(cell12, { key: 'ArrowLeft' });
    expect(cell11).toHaveFocus();

    fireEvent.keyDown(cell11, { key: 'ArrowLeft' });
    expect(cell11).toHaveFocus();
  });

  it('normalizes mobile-style multi-char input bursts to one letter', () => {
    const board = createEmptyBoard();
    const onCellChange = vi.fn();

    render(
      <BoardEditor
        board={board}
        lowConfidenceSet={new Set()}
        onCellChange={onCellChange}
      />,
    );

    const input = screen.getByLabelText('Cell 1-1');
    fireEvent.change(input, { target: { value: 'ab' } });

    expect(onCellChange).toHaveBeenCalledWith(0, 0, 'B', false);
  });

  it('does not render inline tile action buttons', () => {
    const board = createEmptyBoard();

    render(
      <BoardEditor
        board={board}
        lowConfidenceSet={new Set()}
        onCellChange={vi.fn()}
      />,
    );

    expect(screen.queryByRole('button', { name: 'Clear' })).not.toBeInTheDocument();
  });
});
