import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TranslocoService } from '@jsverse/transloco';
import { firstValueFrom } from 'rxjs';
import { ConfirmService } from '../../core/confirm.service';
import { CategoryGroupRepository } from '../../data/category-group.repository';
import { CategoryRepository } from '../../data/category.repository';
import { CategorizationRuleRepository } from '../../data/categorization-rule.repository';
import { MockCategoryGroupRepository } from '../../data/mock/mock-category-group.repository';
import { MockCategoryRepository } from '../../data/mock/mock-category.repository';
import { MockCategorizationRuleRepository } from '../../data/mock/mock-categorization-rule.repository';
import { MOCK_LATENCY_MS } from '../../data/mock/mock-latency';
import { Category } from '../../domain/models/category';
import { CategoryGroup } from '../../domain/models/category-group';
import { RuleConditionEntry, RuleConditionField, RuleConditionOp } from '../../domain/models/categorization-rule';
import { RuleFormModal } from './rule-form-modal';
import { Rules } from './rules';
import { provideTestTransloco, provideTestTranslocoLocale } from '../../../testing/transloco';

interface RuleFormHarness {
  form: {
    controls: Record<string, { setValue(value: string | number | boolean): void }>;
  };
  conditions: () => RuleConditionEntry[];
  saveErrorKey: () => string | null;
  submit(): void;
  setMatchOp(op: 'and' | 'or'): void;
  setEntryField(index: number, field: RuleConditionField): void;
  setEntryOp(index: number, op: RuleConditionOp): void;
  setEntryValue(index: number, value: string): void;
  setGroupOp(index: number, op: 'and' | 'or'): void;
  setGroupField(groupIndex: number, leafIndex: number, field: RuleConditionField): void;
  setGroupOpValue(groupIndex: number, leafIndex: number, op: RuleConditionOp): void;
  setGroupValue(groupIndex: number, leafIndex: number, value: string): void;
  addCondition(): void;
  addGroup(): void;
  addConditionToGroup(index: number): void;
  removeEntry(index: number): void;
  removeGroupCondition(groupIndex: number, leafIndex: number): void;
}

interface RulesHarness {
  rules: () => { id: string; name: string; priority: number; isActive: boolean; matchOp: 'and' | 'or'; categoryId: string; conditions: RuleConditionEntry[] }[];
  categories: () => Category[];
  rulesResource: { reload(): void };
  toggleSort(key: 'priority' | 'name' | 'category'): void;
  exportRules(): void;
  onImportFile(event: Event): Promise<void>;
  deleteRule(rule: ReturnType<RulesHarness['rules']>[number]): Promise<void>;
  reapplyRules(): Promise<void>;
}

describe('Rules', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [
        Rules,
        provideTestTransloco('en-US'),
      ],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        provideTestTranslocoLocale('en-US'),
        { provide: MOCK_LATENCY_MS, useValue: 0 },
        { provide: CategorizationRuleRepository, useClass: MockCategorizationRuleRepository },
        { provide: CategoryRepository, useClass: MockCategoryRepository },
        { provide: CategoryGroupRepository, useClass: MockCategoryGroupRepository },
      ],
    }).compileComponents();
  });

  it('renders the empty state and rule toolbar', async () => {
    const fixture = TestBed.createComponent(Rules);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect((fixture.componentInstance as unknown as RulesHarness).rules()).toHaveLength(0);
  });

  it('creates a rule through the editor and renders its summary', async () => {
    const fixture = TestBed.createComponent(Rules);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const el = fixture.nativeElement as HTMLElement;
    // No stable hook; queried by a Transloco-resolved label, not hardcoded copy.
    const addLabel = TestBed.inject(TranslocoService).translate('rules.actions.add');
    const addButton = [...el.querySelectorAll('button')].find((button) =>
      button.textContent?.includes(addLabel),
    )!;
    addButton.click();
    fixture.detectChanges();

    const dialog = el.querySelector('app-rule-form-modal dialog') as HTMLDialogElement;
    expect(dialog.open).toBe(true);

    const name = dialog.querySelector('#rule-name') as HTMLInputElement;
    name.value = 'Coffee rule';
    name.dispatchEvent(new Event('input'));
    const category = dialog.querySelector('#rule-category') as HTMLSelectElement;
    category.value = category.options[1].value;
    category.dispatchEvent(new Event('change'));
    const conditionValue = [...dialog.querySelectorAll('input[type="text"]')][1] as HTMLInputElement;
    conditionValue.value = 'Coffee';
    conditionValue.dispatchEvent(new Event('input'));

    (dialog.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit', { cancelable: true }));
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(dialog.open).toBe(false);
    expect(el.textContent).toContain('Coffee rule');
  });

  it('validates and edits root and grouped conditions before saving', async () => {
    const fixture = TestBed.createComponent(RuleFormModal);
    const categories: Category[] = [
      { id: 'category-1', name: 'Groceries', kind: 'expense', groupId: 'group-1', color: '#123456', icon: 'cart', position: 0 },
    ];
    const groups: CategoryGroup[] = [
      { id: 'group-1', name: 'Living', kind: 'expense', color: '#123456', icon: 'home', position: 0 },
    ];
    fixture.componentRef.setInput('categories', categories);
    fixture.componentRef.setInput('groups', groups);
    fixture.componentRef.setInput('open', true);
    fixture.detectChanges();
    await fixture.whenStable();

    const form = fixture.componentInstance as unknown as RuleFormHarness;
    form.form.controls['name'].setValue('Amount rule');
    form.form.controls['priority'].setValue(5);
    form.form.controls['categoryId'].setValue('category-1');
    form.removeEntry(0);
    form.submit();
    expect(form.saveErrorKey()).toBe('rules.form.needCondition');

    form.addCondition();
    form.submit();
    expect(form.saveErrorKey()).toBe('rules.form.blankValue');

    form.setEntryField(0, 'amount');
    form.setEntryOp(0, 'gt');
    form.setEntryValue(0, '10');
    form.setMatchOp('or');
    form.addGroup();
    form.setGroupOp(1, 'or');
    form.setGroupField(1, 0, 'type');
    form.setGroupOpValue(1, 0, 'equals');
    form.setGroupValue(1, 0, 'income');
    form.addConditionToGroup(1);
    form.setGroupValue(1, 1, 'expense');
    form.removeGroupCondition(1, 0);
    form.setEntryOp(0, 'regex');
    form.setEntryValue(0, '[');
    form.submit();
    expect(form.saveErrorKey()).toBe('rules.form.badRegex');

    form.setEntryValue(0, '10');
    form.removeEntry(1);
    form.submit();
    await fixture.whenStable();
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('exports, imports, reapplies, sorts, and deletes rules', async () => {
    const fixture = TestBed.createComponent(Rules);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const page = fixture.componentInstance as unknown as RulesHarness;
    const repository = TestBed.inject(CategorizationRuleRepository);
    const category = page.categories()[0];
    const rule = await firstValueFrom(
      repository.create({
        name: 'Existing rule',
        priority: 3,
        isActive: true,
        matchOp: 'and',
        categoryId: category.id,
        conditions: [{ field: 'description', op: 'contains', value: 'Coffee' }],
      }),
    );
    page.rulesResource.reload();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    page.toggleSort('name');
    page.toggleSort('name');
    page.toggleSort('category');
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:rules');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    page.exportRules();

    const translate = vi.spyOn(TestBed.inject(TranslocoService), 'translate');
    const reapply = page.reapplyRules();
    fixture.detectChanges();
    TestBed.inject(ConfirmService).respond(true);
    await reapply;
    fixture.detectChanges();
    expect(translate).toHaveBeenCalledWith('rules.reapply.done', { count: 0 });

    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    const file = new File(
      [JSON.stringify({
        format: 'lealfinance-categorization-rules',
        version: 1,
        rules: [{
          name: 'Imported rule',
          priority: 4,
          isActive: true,
          matchOp: 'and',
          category: category.name,
          conditions: [{ field: 'description', op: 'contains', value: 'Market' }],
        }],
      })],
      'rules.json',
      { type: 'application/json' },
    );
    Object.defineProperty(fileInput, 'files', { value: [file] });
    const importing = page.onImportFile({ target: fileInput } as unknown as Event);
    fixture.detectChanges();
    setTimeout(() => TestBed.inject(ConfirmService).respond(true), 0);
    await importing;
    await fixture.whenStable();
    fixture.detectChanges();
    expect(page.rules()).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'Imported rule' })]));

    const invalidInput = document.createElement('input');
    invalidInput.type = 'file';
    Object.defineProperty(invalidInput, 'files', { value: [new File(['{}'], 'bad.json')] });
    // importError holds an already-translated string, so pin the key it was
    // built from rather than the copy - or the assertion degrades to "some
    // error happened" and stops distinguishing which one.
    const translateInvalid = vi.spyOn(TestBed.inject(TranslocoService), 'translate');
    await page.onImportFile({ target: invalidInput } as unknown as Event);
    fixture.detectChanges();
    expect(fixture.componentInstance['importError']()).toBeTruthy();
    expect(translateInvalid).toHaveBeenCalledWith('rules.import.invalid', expect.anything());

    const deletion = page.deleteRule(rule);
    fixture.detectChanges();
    TestBed.inject(ConfirmService).respond(true);
    await deletion;
    await fixture.whenStable();
    expect(page.rules()).toHaveLength(1);
  });
});
