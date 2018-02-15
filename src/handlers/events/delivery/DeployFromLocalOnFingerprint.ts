/**
 * Deploy a published artifact identified in an ImageLinked event.
 */

import {
    EventFired, EventHandler, GraphQL, HandleEvent, HandlerContext, HandlerResult, logger, Secret,
    Secrets, Success,
} from "@atomist/automation-client";
import { GitHubRepoRef } from "@atomist/automation-client/operations/common/GitHubRepoRef";
import { RemoteRepoRef } from "@atomist/automation-client/operations/common/RepoId";
import { OnDeployToProductionFingerprint, OnImageLinked } from "../../../typings/types";
import { ArtifactStore } from "./ArtifactStore";
import { Deployer } from "./Deployer";
import { deploy } from "./DeployFromLocalOnImageLinked";
import { TargetInfo } from "./Deployment";
import { currentPhaseIsStillPending, GitHubStatusAndFriends, Phases, previousPhaseSucceeded } from "./Phases";
import { BuiltContext, HttpServicePhases } from "./phases/httpServicePhases";

// TODO could make in common with other deployer...
@EventHandler("Deploy linked artifact",
    GraphQL.subscriptionFromFile("../../../../../graphql/subscription/OnDeployToProductionFingerprint.graphql",
        __dirname))
export class DeployFromLocalOnFingerprint<T extends TargetInfo> implements HandleEvent<OnDeployToProductionFingerprint.Subscription> {

    @Secret(Secrets.OrgToken)
    private githubToken: string;

    constructor(private phases: Phases,
                private ourContext: string,
                private endpointContext: string,
                private artifactStore: ArtifactStore,
                private deployer: Deployer<T>,
                private targeter: (id: RemoteRepoRef) => T) {
    }

    public handle(event: EventFired<OnDeployToProductionFingerprint.Subscription>, ctx: HandlerContext, params: this): Promise<HandlerResult> {
        const fingerprint = event.data.Fingerprint[0];
        const commit = fingerprint.commit;

        // TODO doesn't work as built status isn't in, yet
        // const builtStatus = commit.statuses.find(status => status.context === BuiltContext);
        // if (!builtStatus) {
        //     console.log(`Deploy: builtStatus not found`);
        //     return Promise.resolve(Success);
        // }
        const statusAndFriends: GitHubStatusAndFriends = {
            context: BuiltContext,
            state: "success", // builtStatus.state,
            siblings: fingerprint.commit.statuses,
        };

        if (!previousPhaseSucceeded(params.phases, params.ourContext, statusAndFriends)) {
            return Promise.resolve(Success);
        }

        if (!currentPhaseIsStillPending(params.ourContext, statusAndFriends)) {
            return Promise.resolve(Success);
        }

        const id = new GitHubRepoRef(commit.repo.owner, commit.repo.name, commit.sha);
        logger.info("Fingerprint deployer deploying image [%s]", fingerprint.commit.image.imageName);
        return deploy(params.ourContext, params.endpointContext,
            id, params.githubToken,
            fingerprint.commit.image.imageName,
            params.artifactStore, params.deployer, params.targeter);
    }
}