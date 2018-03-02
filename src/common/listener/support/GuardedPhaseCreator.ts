import { Phases } from "../../phases/Phases";
import { PhaseCreationInvocation, PhaseCreator, PushTest } from "../PhaseCreator";
import { allGuardsVoteFor } from "./pushTestUtils";

/**
 * PhaseCreator totally driven by one or more PushTest instances.
 */
export class GuardedPhaseCreator implements PhaseCreator {

    public guard: PushTest;

    /**
     * Create a PhaseCreator that will always return the same phases if the guards
     * match
     * @param {Phases} phases phases to return if the guards return OK
     * @param {PushTest} guard1
     * @param {PushTest} guards
     */
    constructor(private phases: Phases, guard1: PushTest, ...guards: PushTest[]) {
        this.guard =  allGuardsVoteFor(guard1, ...guards);
    }

    public async createPhases(pi: PhaseCreationInvocation): Promise<Phases | undefined> {
        return this.phases;
    }
}