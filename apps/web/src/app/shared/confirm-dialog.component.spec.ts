import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ConfirmDialogComponent } from './confirm-dialog.component';

@Component({
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ConfirmDialogComponent],
  template: `
    <button type="button" id="opener" (click)="open.set(true)">Open</button>
    <mtr-confirm-dialog
      [open]="open()"
      heading="Delete account"
      description="This cannot be undone."
      confirmLabel="Delete"
      [danger]="true"
      [busy]="busy()"
      [hasFields]="withField()"
      (confirmed)="confirmed()"
      (cancelled)="open.set(false)"
    >
      @if (withField()) {
        <input aria-label="Current password" id="field" />
      }
    </mtr-confirm-dialog>
  `,
})
class Harness {
  readonly open = signal(false);
  readonly busy = signal(false);
  readonly withField = signal(false);
  confirmed = vi.fn();
}

describe('ConfirmDialog', () => {
  async function render(setup: (h: Harness) => void = () => undefined) {
    const fixture = TestBed.createComponent(Harness);
    setup(fixture.componentInstance);
    await fixture.whenStable();
    const root = fixture.nativeElement as HTMLElement;
    const opener = root.querySelector('#opener') as HTMLButtonElement;
    opener.focus();
    opener.click();
    await fixture.whenStable();
    return { fixture, root, opener };
  }

  function button(root: HTMLElement, label: string): HTMLButtonElement {
    return Array.from(root.querySelectorAll('button')).find((b) => b.textContent?.trim() === label) as HTMLButtonElement;
  }

  function key(init: KeyboardEventInit) {
    document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init }));
  }

  it('focuses Cancel rather than the destructive action and restores focus on Escape', async () => {
    const { fixture, root, opener } = await render();
    const panel = root.querySelector('[role="alertdialog"]') as HTMLElement;
    expect(panel.querySelector('h2')?.textContent).toBe('Delete account');
    expect(panel.getAttribute('aria-labelledby')).toBe(panel.querySelector('h2')?.id);
    expect(document.activeElement).toBe(button(root, 'Annuler'));

    key({ key: 'Escape' });
    await fixture.whenStable();
    expect(root.querySelector('[role="alertdialog"]')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it('focuses the first step-up field and traps Tab inside the panel', async () => {
    const { root } = await render((h) => h.withField.set(true));
    const field = root.querySelector('#field') as HTMLInputElement;
    const confirm = button(root, 'Delete');
    expect(document.activeElement).toBe(field);

    confirm.focus();
    key({ key: 'Tab' });
    expect(document.activeElement).toBe(field);

    key({ key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(confirm);
  });

  it('submits step-up fields with Enter', async () => {
    const { fixture, root } = await render((h) => h.withField.set(true));
    const form = root.querySelector('[role="alertdialog"] form') as HTMLFormElement;
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    expect(fixture.componentInstance.confirmed).toHaveBeenCalledTimes(1);
  });

  it('ignores Escape and Enter while busy', async () => {
    const { fixture, root } = await render((h) => {
      h.withField.set(true);
      h.busy.set(true);
    });
    const form = root.querySelector('[role="alertdialog"] form') as HTMLFormElement;
    form.dispatchEvent(new Event('submit', { cancelable: true }));
    key({ key: 'Escape' });
    await fixture.whenStable();
    expect(fixture.componentInstance.confirmed).not.toHaveBeenCalled();
    expect(root.querySelector('[role="alertdialog"]')).not.toBeNull();
    expect(button(root, 'Traitement…').disabled).toBe(true);
  });
});
