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

import { GraphQL, Secret, Secrets, Success } from "@atomist/automation-client";
import { EventFired, EventHandler, HandleEvent, HandlerContext } from "@atomist/automation-client/Handlers";
import { GitHubRepoRef } from "@atomist/automation-client/operations/common/GitHubRepoRef";
import { RemoteRepoRef } from "@atomist/automation-client/operations/common/RepoId";
import { OnDeployableArtifact, StatusState } from "../../../typings/types";
import { createGist, createStatus } from "../../commands/editors/toclient/ghub";
import { parseCloudFoundryLog } from "./deploy/pcf/cloudFoundryLogParser";
import { Deployer } from "./Deployer";
import { AppInfo, TargetInfo } from "./Deployment";
import { SavingProgressLog } from "./ProgressLog";

export interface DeployableArtifact extends AppInfo {

    cwd: string;

    filename: string;
}

/**
 * Function that can check out an artifact to a local directory, given a URL
 */
export type ArtifactCheckout = (targetUrl: string) => Promise<DeployableArtifact>;

/**
 * Deploy a published artifact identified in a GitHub "artifact" status.
 */
@EventHandler("Deploy published artifact",
    GraphQL.subscriptionFromFile("graphql/subscription/OnDeployableArtifact.graphql"))
export class DeployOnArtifactStatus<T extends TargetInfo> implements HandleEvent<OnDeployableArtifact.Subscription> {

    @Secret(Secrets.OrgToken)
    private githubToken: string;

    constructor(private artifactCheckout: ArtifactCheckout,
                private cfDeployer: Deployer<T>,
                private targeter: (id: RemoteRepoRef) => T) {
    }

    public handle(event: EventFired<OnDeployableArtifact.Subscription>, ctx: HandlerContext, params: this): Promise<any> {

        // TODO this is horrid
        const commit = event.data.Status[0].commit;

        const id = new GitHubRepoRef(commit.repo.owner, commit.repo.name, commit.sha);

        const persistentLog = new SavingProgressLog();
        const progressLog = persistentLog;

        const targetUrl = event.data.Status[0].targetUrl;
        return setDeployStatus(params.githubToken, id, "pending", "http://test.com")
            .then(() => {
                return this.artifactCheckout(targetUrl)
                    .then(ac => {
                        return this.cfDeployer.deploy(ac, params.targeter(id), progressLog)
                            .then(deployment => {
                                deployment.childProcess.stdout.on("data", what => progressLog.write(what.toString()));
                                deployment.childProcess.addListener("exit", (code, signal) => {
                                    const di = parseCloudFoundryLog(persistentLog.log);
                                    return createGist(params.githubToken, {
                                        description: `Deployment log for ${id.owner}/${id.repo}`,
                                        public: false,
                                        files: [{
                                            path: `${id.owner}_${id.repo}-${id.sha}.log`,
                                            content: persistentLog.log,
                                        }],
                                    })
                                        .then(gist => setDeployStatus(params.githubToken, id, "success", gist))
                                        .then(() => {
                                            return !!di ?
                                                setEndpointStatus(params.githubToken, id, di.endpoint) :
                                                true;
                                        });

                                });
                                deployment.childProcess.addListener("error", (code, signal) => {
                                    return createGist(params.githubToken, {
                                        description: `Failed deployment log for ${id.owner}/${id.repo}`,
                                        public: false,
                                        files: [{
                                            path: `${id.owner}_${id.repo}-${id.sha}.log`,
                                            content: persistentLog.log,
                                        }],
                                    })
                                        .then(gist => setDeployStatus(params.githubToken, id, "failure", gist));
                                });
                                return Success;
                            });
                    });
            });
    }

}

function setDeployStatus(token: string, id: GitHubRepoRef, state: StatusState, target_url: string): Promise<any> {
    return createStatus(token, id, {
        state,
        target_url,
        context: "deployment",
    });
}

function setEndpointStatus(token: string, id: GitHubRepoRef, endpoint: string): Promise<any> {
    return createStatus(token, id, {
        state: "success",
        target_url: endpoint,
        context: "endpoint",
    });
}