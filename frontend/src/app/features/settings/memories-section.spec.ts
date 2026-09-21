import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { ApiError } from '../../core/api-error';
import { ConfirmService } from '../../core/confirm.service';
import { AgentChatRepository } from '../../data/agent-chat.repository';
import { AgentMemory } from '../../domain/models/agent-chat';
import { provideTestTransloco, provideTestTranslocoLocale } from '../../../testing/transloco';
import { MemoriesSection } from './memories-section';

describe('MemoriesSection', () => {
  const memory = (id: string, content: string): AgentMemory => ({
    id,
    content,
    createdAt: '2026-09-20T12:00:00Z',
  });
  let repo: {
    listMemories: ReturnType<typeof vi.fn>;
    deleteMemory: ReturnType<typeof vi.fn>;
  };
  let confirm: { confirm: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    repo = {
      listMemories: vi
        .fn()
        .mockReturnValue(of([memory('m1', 'Gets paid on the 5th'), memory('m2', 'Saves in EUR')])),
      deleteMemory: vi.fn().mockReturnValue(of(undefined)),
    };
    confirm = { confirm: vi.fn().mockResolvedValue(true) };
    await TestBed.configureTestingModule({
      imports: [MemoriesSection, provideTestTransloco()],
      providers: [
        provideZonelessChangeDetection(),
        provideTestTranslocoLocale(),
        { provide: AgentChatRepository, useValue: repo },
        { provide: ConfirmService, useValue: confirm },
      ],
    }).compileComponents();
  });

  it('lists the saved memories', () => {
    const fixture = TestBed.createComponent(MemoriesSection);
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent;
    expect(text).toContain('Gets paid on the 5th');
    expect(text).toContain('Saves in EUR');
    expect(fixture.nativeElement.querySelectorAll('li')).toHaveLength(2);
  });

  it('shows the empty state once loading finishes with nothing saved', () => {
    repo.listMemories.mockReturnValue(of([]));
    const fixture = TestBed.createComponent(MemoriesSection);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelectorAll('li')).toHaveLength(0);
    expect(fixture.nativeElement.textContent).toContain('ainda não salvou');
  });

  it('shows an error, not the empty state, when loading fails', () => {
    repo.listMemories.mockReturnValue(throwError(() => new Error('down')));
    const fixture = TestBed.createComponent(MemoriesSection);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('[role="alert"]')).not.toBeNull();
    expect(fixture.nativeElement.textContent).not.toContain('ainda não salvou');
  });

  it('removes only the chosen memory after confirmation', async () => {
    const fixture = TestBed.createComponent(MemoriesSection);
    fixture.detectChanges();

    await fixture.componentInstance['remove'](memory('m1', 'Gets paid on the 5th'));
    fixture.detectChanges();

    expect(confirm.confirm).toHaveBeenCalledWith(
      'settings.memories.removeConfirm.title',
      'settings.memories.removeConfirm.message',
      'danger',
    );
    expect(repo.deleteMemory).toHaveBeenCalledWith('m1');
    expect(fixture.nativeElement.textContent).not.toContain('Gets paid on the 5th');
    expect(fixture.nativeElement.textContent).toContain('Saves in EUR');
  });

  it('keeps the memory when the user declines the confirmation', async () => {
    confirm.confirm.mockResolvedValue(false);
    const fixture = TestBed.createComponent(MemoriesSection);
    fixture.detectChanges();

    await fixture.componentInstance['remove'](memory('m1', 'Gets paid on the 5th'));

    expect(repo.deleteMemory).not.toHaveBeenCalled();
    expect(fixture.componentInstance['memories']()).toHaveLength(2);
  });

  it('reports the error and reloads the list when the delete fails', async () => {
    repo.deleteMemory.mockReturnValue(
      throwError(() => new ApiError(404, 'agent_memory.not_found', { id: 'm1' })),
    );
    const fixture = TestBed.createComponent(MemoriesSection);
    fixture.detectChanges();

    await fixture.componentInstance['remove'](memory('m1', 'Gets paid on the 5th'));

    expect(fixture.componentInstance['errorCode']()).toBe('agent_memory.not_found');
    expect(repo.listMemories).toHaveBeenCalledTimes(2);
    expect(fixture.componentInstance['busy']()).toBe(false);
  });
});
