import { CasesError, type Case, type CasesApi, type NewCase } from './cases-api.js';

export interface MemoryCasesApi extends CasesApi {
  /** What it holds now, newest first. */
  readonly cases: readonly Case[];
  /** The next create fails with this reason, once. */
  failNextCreate(reason: string): void;
}

/** The cases kept in memory, for the demo and the tests. `delayMs` makes each call take that long, so loading shows. */
export function createMemoryCasesApi(seed: Case[] = [], opts: { delayMs?: number } = {}): MemoryCasesApi {
  let cases = [...seed];
  let failure: string | null = null;
  const wait = () => new Promise((resolve) => setTimeout(resolve, opts.delayMs ?? 0));

  return {
    get cases() {
      return cases;
    },
    failNextCreate(reason) {
      failure = reason;
    },
    async list() {
      await wait();
      return [...cases];
    },
    async create(input: NewCase) {
      await wait();
      if (failure !== null) {
        const reason = failure;
        failure = null;
        throw new CasesError('ENTITY_VALIDATION_RULE_FAILED', reason);
      }
      // A UUID, as AgentFlow's record ids are: AgentFlow's host ignores a record id of any other shape.
      const made: Case = { id: crypto.randomUUID(), title: input.title, urgent: input.urgent, openedOn: input.openedOn, status: 'open' };
      cases = [made, ...cases];
      return made;
    },
  };
}
