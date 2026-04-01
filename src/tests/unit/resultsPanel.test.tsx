import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ResultsPanel } from '../../components/ResultsPanel';
import type { MoveCandidate } from '../../types/game';

function makeMove(overrides: Partial<MoveCandidate>): MoveCandidate {
  return {
    word: 'MOVE',
    row: 7,
    col: 7,
    direction: 'across',
    score: 10,
    crossWordCount: 0,
    crossWordLetters: 0,
    adjacentExistingTileCount: 0,
    maxAdjacentExistingTiles: 0,
    threadedTileCount: 0,
    leaveValue: 0,
    totalEval: 10,
    ...overrides,
  };
}

describe('ResultsPanel sections', () => {
  it('shows top scores, cross-word-heavy plays, and funny words', () => {
    const onSelect = vi.fn();
    const moves: MoveCandidate[] = [
      makeMove({ word: 'ZA', score: 18, totalEval: 19 }),
      makeMove({
        word: 'FART',
        row: 5,
        col: 5,
        score: 30,
        totalEval: 30,
        crossWordCount: 2,
        crossWordLetters: 6,
        adjacentExistingTileCount: 4,
        maxAdjacentExistingTiles: 2,
        threadedTileCount: 1,
      }),
      makeMove({
        word: 'AX',
        row: 9,
        col: 3,
        score: 24,
        totalEval: 25,
        crossWordCount: 3,
        crossWordLetters: 9,
        adjacentExistingTileCount: 5,
        maxAdjacentExistingTiles: 3,
        threadedTileCount: 1,
      }),
    ];

    render(<ResultsPanel moves={moves} selectedMoveIndex={0} onSelect={onSelect} />);

    expect(screen.getByText('Top 10 Scores')).toBeInTheDocument();
    expect(screen.getByText('Cross-Word Heavy')).toBeInTheDocument();
    expect(screen.getByText('Funny Words')).toBeInTheDocument();
    expect(screen.getAllByText(/Creates 3 cross words/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/9 total cross letters/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/best hook touches 3 existing tiles/).length).toBeGreaterThan(0);

    fireEvent.click(screen.getAllByRole('button', { name: 'Select FART F6 →' })[0]);
    expect(onSelect).toHaveBeenCalledWith(1);
  });

  it('keeps dense connector plays in the cross-word section even without new cross words', () => {
    render(
      <ResultsPanel
        moves={[
          makeMove({
            word: 'HOOK',
            row: 6,
            col: 4,
            score: 22,
            totalEval: 23,
            adjacentExistingTileCount: 5,
            maxAdjacentExistingTiles: 3,
            threadedTileCount: 1,
          }),
        ]}
        selectedMoveIndex={0}
        onSelect={vi.fn()}
      />,
    );

    expect(screen.getByText('Cross-Word Heavy')).toBeInTheDocument();
    expect(screen.getAllByText(/best hook touches 3 existing tiles/).length).toBeGreaterThan(0);
    expect(screen.queryByText('No cross-word-heavy or threaded plays in the current pool.')).not.toBeInTheDocument();
  });

  it('shows an empty funny section message when no funny words exist', () => {
    render(
      <ResultsPanel
        moves={[
          makeMove({
            word: 'AXE',
            score: 20,
            totalEval: 21,
            crossWordCount: 1,
            crossWordLetters: 3,
            adjacentExistingTileCount: 1,
            maxAdjacentExistingTiles: 1,
          }),
        ]}
        selectedMoveIndex={0}
        onSelect={vi.fn()}
      />,
    );

    expect(screen.getByText('No funny words in the current move pool.')).toBeInTheDocument();
  });
});
