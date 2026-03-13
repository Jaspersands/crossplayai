import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import App from '../../App';

vi.mock('../../workers/client', () => ({
  parseWithWorker: vi.fn().mockResolvedValue(null),
  initSolverLexicon: vi.fn().mockResolvedValue(undefined),
  solveWithWorker: vi.fn().mockResolvedValue([]),
}));

vi.mock('../../lib/dictionary', () => ({
  loadDictionary: vi.fn().mockResolvedValue({
    id: 'lexicon-test',
    name: 'Mock Dictionary',
    wordCount: 1,
    loadedFromCache: true,
    source: 'mock',
  }),
  getLexiconSnapshot: vi.fn().mockReturnValue({
    id: 'lexicon-test',
    words: ['A'],
  }),
  loadCrossplayBlocklist: vi.fn().mockResolvedValue(new Set()),
}));

describe('route rendering', () => {
  it('renders integrated workflow at /corrections', () => {
    render(
      <MemoryRouter initialEntries={['/corrections']}>
        <App />
      </MemoryRouter>,
    );

    expect(screen.getByRole('heading', { name: 'Crossplay Scrabble Move Finder' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '1. Upload Crossplay Screenshot' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Confirm board state' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Solve top moves' })).toBeInTheDocument();

    const exportButton = screen.getByRole('button', { name: 'Export corrections JSON' });
    expect(exportButton).toBeDisabled();
  });

  it('renders main solver page at root', () => {
    render(
      <MemoryRouter initialEntries={['/']}>
        <App />
      </MemoryRouter>,
    );

    expect(screen.getAllByRole('heading', { name: 'Crossplay Scrabble Move Finder' }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: 'Solve top moves' }).length).toBeGreaterThan(0);
  });
});
