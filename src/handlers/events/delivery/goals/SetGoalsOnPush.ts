/*
 * Copyright © 2018 Atomist, Inc.
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

import {
    EventFired,
    EventHandler,
    HandleEvent,
    HandlerContext,
    HandlerResult,
    logger,
    MappedParameter,
    MappedParameters,
    Parameter,
    Secret,
    Secrets,
    Success,
} from "@atomist/automation-client";
import { Parameters } from "@atomist/automation-client/decorators";
import { subscription } from "@atomist/automation-client/graph/graphQL";
import { GitHubRepoRef } from "@atomist/automation-client/operations/common/GitHubRepoRef";
import { ProjectOperationCredentials } from "@atomist/automation-client/operations/common/ProjectOperationCredentials";
import { GitProject } from "@atomist/automation-client/project/git/GitProject";
import { NoGoals } from "../../../../common/delivery/goals/common/commonGoals";
import { Goals } from "../../../../common/delivery/goals/Goals";
import { GoalSetter } from "../../../../common/listener/GoalSetter";
import { ProjectListenerInvocation } from "../../../../common/listener/Listener";
import { PushMapping } from "../../../../common/listener/PushMapping";
import { PushRules } from "../../../../common/listener/support/PushRules";
import { ProjectLoader } from "../../../../common/repo/ProjectLoader";
import { addressChannelsFor } from "../../../../common/slack/addressChannels";
import { OnPushToAnyBranch } from "../../../../typings/types";
import { createStatus, tipOfDefaultBranch } from "../../../../util/github/ghub";

/**
 * Set up goals on a push (e.g. for delivery).
 */
@EventHandler("Set up goals", subscription("OnPushToAnyBranch"))
export class SetGoalsOnPush implements HandleEvent<OnPushToAnyBranch.Subscription> {

    @Secret(Secrets.OrgToken)
    private githubToken: string;

    private readonly goalSetters: GoalSetter[];

    private readonly rules: PushMapping<Goals>;

    /**
     * Configure goal setting
     * @param projectLoader use to load projects
     * @param goalSetters first GoalSetter that returns goals wins
     */
    constructor(private projectLoader: ProjectLoader,
                ...goalSetters: GoalSetter[]) {
        this.goalSetters = goalSetters;
        this.rules = new PushRules("Goal setter", goalSetters);
    }

    public async handle(event: EventFired<OnPushToAnyBranch.Subscription>,
                        context: HandlerContext,
                        params: this): Promise<HandlerResult> {
        const push: OnPushToAnyBranch.Push = event.data.Push[0];
        const commit = push.commits[0];
        const id = GitHubRepoRef.from({
            owner: push.repo.owner,
            repo: push.repo.name,
            sha: commit.sha,
            rawApiBase: push.repo.org.provider.apiUrl,
            branch: push.branch,
        });
        const credentials = {token: params.githubToken};
        return this.projectLoader.doWithProject({credentials, id, context, readOnly: true}, project =>
            this.setGoalsForPushOnProject(push, id, credentials, context, params, project),
        );
    }

    private async setGoalsForPushOnProject(push: OnPushToAnyBranch.Push,
                                           id: GitHubRepoRef,
                                           credentials: ProjectOperationCredentials,
                                           context: HandlerContext,
                                           params: this,
                                           project: GitProject): Promise<HandlerResult> {
        const addressChannels = addressChannelsFor(push.repo, context);
        const pi: ProjectListenerInvocation = {
            id,
            project,
            credentials,
            push,
            context,
            addressChannels,
        };

        try {
            const determinedGoals: Goals = await this.rules.valueForPush(pi);
            logger.info("Goals for push on %j are %s", id, determinedGoals.name);
            if (determinedGoals === NoGoals) {
                await createStatus(params.githubToken, id, {
                    context: "Immaterial",
                    state: "success",
                    description: "No significant change",
                });
            } else if (!determinedGoals) {
                logger.info("No goals set by push to %s:%s on %s", id.owner, id.repo, push.branch);
            } else {
                await determinedGoals.setAllToPending(id, credentials, context, push.repo.org.provider.providerId);
            }
            return Success;
        } catch (err) {
            logger.error("Error determining goals: %s", err);
            await addressChannels(`Serious error trying to determine goals. Please check SDM logs: ${err}`);
            return {code: 1, message: "Failed: " + err};
        }
    }
}

@Parameters()
export class ApplyGoalsParameters {
    @Secret(Secrets.UserToken)
    public githubToken: string;

    @MappedParameter(MappedParameters.GitHubOwner)
    public owner: string;

    @MappedParameter(MappedParameters.GitHubRepository)
    public repo: string;

    @MappedParameter(MappedParameters.GitHubRepositoryProvider)
    public providerId: string;

    @Parameter({required: false})
    public sha?: string;
}

export function applyGoalsToCommit(goals: Goals) {
    return async (ctx: HandlerContext,
                  params: { githubToken: string, owner: string, repo: string, sha?: string, providerId: string }) => {
        const sha = params.sha ? params.sha :
            await tipOfDefaultBranch(params.githubToken, new GitHubRepoRef(params.owner, params.repo));
        const id = new GitHubRepoRef(params.owner, params.repo, sha);
        const creds = {token: params.githubToken};

        await goals.setAllToPending(id, creds, ctx, params.providerId);
        await ctx.messageClient.respond(":heavy_check_mark: Statuses reset on " + sha);
        return Success;
    };
}
