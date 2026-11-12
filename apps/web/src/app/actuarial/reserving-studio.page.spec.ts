import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { ActuarialApi, type ReservingCatalogue, type ReservingRequest, type ReservingResult, type ReservingRunDetail } from '../core/api/actuarial-api';
import { ApiError } from '../core/api/types';
import hand from './__fixtures__/reservingHand.json';
import { change, getButton, getControl, getText, kpi, settle, tableByCaption, waitFor } from './actuarial-testing';
import { ReservingStudioPage } from './reserving-studio.page';

/** Output of the server model (pif-reserving-1.0.0) for the hand-checked 3 × 3 triangle; see __fixtures__. */
const request = hand.request as unknown as ReservingRequest;
const results = hand.results as unknown as ReservingResult;
const provenance = { kind: 'MODEL_ESTIMATE' as const, currency: 'TND', modelVersion: results.modelVersion, note: 'Deterministic best estimates.' };

const catalogue: ReservingCatalogue = {
  modelVersion: results.modelVersion,
  currency: 'TND',
  limits: { minOrigins: 3, maxOrigins: 25, minFirstOrigin: 1950, maxFirstOrigin: 2100, maxAmount: 1e12, minFactor: 0.1, maxFactor: 100, minTail: 0.5, maxTail: 3, minLossRatio: 0.01, maxLossRatio: 5 },
  averages: ['VOLUME_WEIGHTED', 'SIMPLE_AVERAGE', 'LATEST_DIAGONALS'],
  methods: [
    { id: 'CHAIN_LADDER_PAID', label: 'Chain ladder (paid)' },
    { id: 'CHAIN_LADDER_INCURRED', label: 'Chain ladder (incurred)' },
    { id: 'EXPECTED_LOSS_RATIO', label: 'Expected loss ratio' },
    { id: 'BORNHUETTER_FERGUSON_PAID', label: 'Bornhuetter–Ferguson (paid)' },
    { id: 'BORNHUETTER_FERGUSON_INCURRED', label: 'Bornhuetter–Ferguson (incurred)' },
  ],
  examples: [{ id: 'hand', name: 'Hand-checked triangle', description: 'Three accident years.', provenance: 'FICTIONAL', ...request }],
};

function runDetail(overrides: Partial<ReservingRunDetail> = {}): ReservingRunDetail {
  return {
    id: '22222222-2222-4222-8222-222222222222',
    label: 'Hand check',
    modelVersion: results.modelVersion,
    stale: false,
    currency: 'TND',
    firstOrigin: 2023,
    originCount: 3,
    valuationYear: 2025,
    dataChecksum: 'a'.repeat(64),
    headline: { paid: 481, incurred: 578, caseReserve: 97, methods: [{ method: 'CHAIN_LADDER_PAID', ultimate: 588, unpaid: 107 }], warnings: results.warnings.length },
    createdAt: '2026-11-09T18:00:00.000Z',
    inputs: request,
    results,
    ...overrides,
  };
}

const summary = (run: ReservingRunDetail) => {
  const { inputs, results: stored, ...rest } = run;
  void inputs;
  void stored;
  return rest;
};

let api: {
  reservingExamples: ReturnType<typeof vi.fn>;
  analyzeReserving: ReturnType<typeof vi.fn>;
  saveReservingRun: ReturnType<typeof vi.fn>;
  reservingRuns: ReturnType<typeof vi.fn>;
  reservingRun: ReturnType<typeof vi.fn>;
  deleteReservingRun: ReturnType<typeof vi.fn>;
};

async function render() {
  TestBed.configureTestingModule({ imports: [ReservingStudioPage], providers: [provideRouter([]), { provide: ActuarialApi, useValue: api }] });
  const fixture = TestBed.createComponent(ReservingStudioPage);
  const root = fixture.nativeElement as HTMLElement;
  await settle(fixture);
  return { fixture, root };
}

describe('ReservingStudio', () => {
  beforeEach(() => {
    api = {
      reservingExamples: vi.fn().mockResolvedValue(catalogue),
      analyzeReserving: vi.fn().mockResolvedValue({ provenance, results }),
      saveReservingRun: vi.fn(),
      reservingRuns: vi.fn().mockResolvedValue({ kept: 25, runs: [] }),
      reservingRun: vi.fn(),
      deleteReservingRun: vi.fn(),
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sends the example to the server and shows only the figures it returns', async () => {
    const { fixture, root } = await render();
    expect(getControl<HTMLTextAreaElement>(root, 'Cumulative paid (DT)')).toBeTruthy();
    await waitFor(fixture, () => expect(api.analyzeReserving).toHaveBeenCalledTimes(1));
    expect(api.analyzeReserving.mock.calls[0][0]).toEqual(request);

    await waitFor(fixture, () => expect(kpi(root, 'Paid to date')).toBeTruthy());
    expect(getText(kpi(root, 'Paid to date'), '481 DT')).toBeTruthy();
    expect(getText(kpi(root, 'Unpaid'), '107 DT')).toBeTruthy();
    expect(getText(root, 'Results match the inputs.')).toBeTruthy();
    expect(getText(root, /Deterministic best estimates\./)).toBeTruthy();
    expect(getText(root, /^Reconciled:/)).toBeTruthy();

    const methods = tableByCaption(root, /Total ultimate, unpaid and IBNR by reserving method/);
    expect(getText(methods, '588 DT')).toBeTruthy();

    change(getControl<HTMLSelectElement>(root, 'Method for the headline figures'), 'EXPECTED_LOSS_RATIO');
    await settle(fixture);
    expect(getText(kpi(root, 'Ultimate'), '528 DT')).toBeTruthy();
    expect(getText(kpi(root, 'Unpaid'), '47 DT')).toBeTruthy();
  });

  it('parses pasted triangles, keeps missing amounts as null and reports server rejections', async () => {
    const { fixture, root } = await render();
    const paid = getControl<HTMLTextAreaElement>(root, 'Cumulative paid (DT)');
    await waitFor(fixture, () => expect(api.analyzeReserving).toHaveBeenCalledTimes(1));

    change(paid, '100 150 abc\n120 186\n130');
    await settle(fixture);
    expect(getText(root, 'Line 1, amount 3: “abc” is not a number. Write a missing amount as -.')).toBeTruthy();
    expect(getText(root, 'Fix the highlighted fields to update the reserves.')).toBeTruthy();

    api.analyzeReserving.mockRejectedValue(
      new ApiError(422, 'Invalid triangle: the latest paid amount of accident year 2024 (development year 2) is missing.', 'INVALID_TRIANGLE'),
    );
    change(paid, '100\t150\t165\n120\t-\n130\t\t');
    await waitFor(fixture, () => expect(api.analyzeReserving).toHaveBeenCalledTimes(2));
    expect(api.analyzeReserving.mock.calls[1][0].data.paid).toEqual([[100, 150, 165], [120, null], [130]]);
    await waitFor(fixture, () => expect(getText(root, /the latest paid amount of accident year 2024/)).toBeTruthy());
    expect(getText(root, /The results below were computed for earlier inputs/)).toBeTruthy();
  });

  it('sends a selected development factor and validates its range locally', async () => {
    const { fixture, root } = await render();
    await waitFor(fixture, () => getControl(root, 'Selected paid factor, development years 1 to 2'));
    await waitFor(fixture, () => expect(api.analyzeReserving).toHaveBeenCalledTimes(1));
    const input = getControl(root, 'Selected paid factor, development years 1 to 2');

    change(input, '500');
    await settle(fixture);
    expect(getText(root, 'Enter a factor from 0.1 to 100, or leave it empty to use the estimate.')).toBeTruthy();

    change(input, '1.6');
    await waitFor(fixture, () => expect(api.analyzeReserving).toHaveBeenCalledTimes(2));
    expect(api.analyzeReserving.mock.calls[1][0].assumptions.selectedFactors).toEqual({ paid: [1.6, null], incurred: null });
  });

  it('saves, reloads and deletes a run', async () => {
    const stored = runDetail({ inputs: { ...request, assumptions: { ...request.assumptions, tail: { paid: 1.05, incurred: 1 } } } });
    api.saveReservingRun.mockResolvedValue(runDetail());
    api.reservingRun.mockResolvedValue(stored);
    api.deleteReservingRun.mockResolvedValue(undefined);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const { fixture, root } = await render();
    await waitFor(fixture, () => expect(api.analyzeReserving).toHaveBeenCalledTimes(1));
    await waitFor(fixture, () => expect(getText(root, 'Results match the inputs.')).toBeTruthy());

    change(getControl(root, 'Run label'), 'Hand check');
    api.reservingRuns.mockResolvedValue({ kept: 25, runs: [summary(stored)] });
    await settle(fixture);
    getButton(root, /Enregistrer le calcul/).click();
    await waitFor(fixture, () => expect(api.saveReservingRun).toHaveBeenCalledWith('Hand check', request));
    await waitFor(fixture, () => expect(getText(root, '« Hand check » enregistré.')).toBeTruthy());

    await waitFor(fixture, () => getButton(root, 'Charger Hand check'));
    getButton(root, 'Charger Hand check').click();
    await waitFor(fixture, () => expect(getText(root, /Loaded “Hand check”/)).toBeTruthy());
    expect(getControl(root, 'Paid tail factor').value).toBe('1.05');
    expect(getText(root, 'Showing the stored results of “Hand check”.')).toBeTruthy();
    expect(api.analyzeReserving).toHaveBeenCalledTimes(1);

    api.reservingRuns.mockResolvedValue({ kept: 25, runs: [] });
    getButton(root, 'Supprimer Hand check').click();
    await waitFor(fixture, () => expect(api.deleteReservingRun).toHaveBeenCalledWith(stored.id));
    await waitFor(fixture, () => expect(getText(root, 'Aucun calcul enregistré')).toBeTruthy());
  });

  it('explains when saved runs are not enabled on the server', async () => {
    api.reservingRuns.mockRejectedValue(new ApiError(503, 'Schema outdated.', 'DATABASE_SCHEMA_OUTDATED'));
    const { fixture, root } = await render();
    await waitFor(fixture, () =>
      expect(getText(root, /Les simulations de provisionnement enregistrées ne sont pas encore activées/)).toBeTruthy(),
    );
  });
});
