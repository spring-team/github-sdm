/*
 * Copyright © 2017 Atomist, Inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { GraphQL, HandlerResult, Secret, Secrets, success, Success } from "@atomist/automation-client";
import { EventFired, EventHandler, HandleEvent, HandlerContext } from "@atomist/automation-client/Handlers";
import { GitHubRepoRef } from "@atomist/automation-client/operations/common/GitHubRepoRef";
import { OnImageLinked } from "../../../../typings/types";
import { createStatus } from "../../../commands/editors/toclient/ghub";
import { PlannedPhase } from "../Phases";

/**
 * Deploy a published artifact identified in an ImageLinked event.
 */
@EventHandler("Set build phase to complete with link to artifact",
    GraphQL.subscriptionFromFile("graphql/subscription/OnImageLinked.graphql"))
export class FindArtifactOnImageLinked implements HandleEvent<OnImageLinked.Subscription> {

    @Secret(Secrets.OrgToken)
    private githubToken: string;

    /**
     * The phase to update when an artifact is linked.
     * When an artifact is linked to a commit, the build must be done.
     */
    constructor(private artifactPhase: PlannedPhase) {
    }

    public handle(event: EventFired<OnImageLinked.Subscription>, ctx: HandlerContext, params: this): Promise<HandlerResult> {
        const imageLinked = event.data.ImageLinked[0];
        const commit = imageLinked.commit;
        const image = imageLinked.image;
        const id = new GitHubRepoRef(commit.repo.owner, commit.repo.name, commit.sha);

        const builtStatus = commit.statuses.find(status => status.context === params.artifactPhase.context);
        if (!builtStatus) {
            console.log(`Deploy: builtStatus not found`);
            return Promise.resolve(Success);
        }

        return createStatus(params.githubToken, id, {
            state: "success",
            description: `Complete: ${params.artifactPhase.name}`,
            // TODO: this might not be a URL, in which case, put it in the description instead. which might mess up the deploy, check on that
            target_url: image.imageName,
            context: params.artifactPhase.context,
        }).then(success);
    }
}
