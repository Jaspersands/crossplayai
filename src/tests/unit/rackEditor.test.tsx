import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { RackEditor } from '../../components/RackEditor';

describe('RackEditor interactions', () => {
  it('replaces the focused tile when typing and advances focus', () => {
    const onRackChange = vi.fn();

    render(
      <RackEditor
        rack={[
          { letter: 'A', isBlank: false },
          { letter: '', isBlank: false },
        ]}
        onRackChange={onRackChange}
      />,
    );

    const firstTile = screen.getByLabelText('Rack tile 1');
    const secondTile = screen.getByLabelText('Rack tile 2');

    firstTile.focus();
    fireEvent.keyDown(firstTile, { key: 'z' });

    expect(onRackChange).toHaveBeenCalledWith(0, 'Z', false);
    expect(secondTile).toHaveFocus();
  });

  it('normalizes mobile-style multi-character input bursts and advances focus', () => {
    const onRackChange = vi.fn();

    render(
      <RackEditor
        rack={[
          { letter: '', isBlank: false },
          { letter: '', isBlank: false },
        ]}
        onRackChange={onRackChange}
      />,
    );

    const firstTile = screen.getByLabelText('Rack tile 1');
    const secondTile = screen.getByLabelText('Rack tile 2');

    fireEvent.change(firstTile, { target: { value: 'ab' } });

    expect(onRackChange).toHaveBeenCalledWith(0, 'B', false);
    expect(secondTile).toHaveFocus();
  });
});
