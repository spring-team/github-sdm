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
    failure,
    HandleCommand,
    MappedParameter,
    MappedParameters,
    Success,
} from "@atomist/automation-client";
import { Parameters } from "@atomist/automation-client/decorators";
import { HandlerContext } from "@atomist/automation-client/Handlers";
import { commandHandlerFrom } from "@atomist/automation-client/onCommand";
import { addressEvent } from "@atomist/automation-client/spi/message/MessageClient";
import {
    DeployEnablement,
    DeployEnablementRootType,
} from "../../ingesters/deployEnablement";
import { success } from "../../util/slack/messages";

@Parameters()
export class ToggleDeployEnablementParameters {

    @MappedParameter(MappedParameters.GitHubOwner)
    public owner: string;

    @MappedParameter(MappedParameters.GitHubRepository)
    public repo: string;

    @MappedParameter(MappedParameters.GitHubRepositoryProvider)
    public providerId: string;

}

function toggleEnablement(enable: boolean) {
    return (ctx: HandlerContext, params: ToggleDeployEnablementParameters) => {
        const deployEnablement: DeployEnablement = {
            state: enable ? "requested" : "disabled",
            owner: params.owner,
            repo: params.repo,
            providerId: params.providerId,
        };
        return ctx.messageClient.send(deployEnablement, addressEvent(DeployEnablementRootType))
            .then(() => ctx.messageClient.respond(
                success(
                    "Deploy Enablement",
                    `Successfully ${enable ? "enabled" : "disabled"} deployment`)))
            .then(() => Success, failure);
    };
}

export function enableDeploy(): HandleCommand<ToggleDeployEnablementParameters> {
    return commandHandlerFrom(
        toggleEnablement(true),
        ToggleDeployEnablementParameters,
        "EnableDeploy",
        "Enable deployment via Atomist SDM",
        "enable deploy",
    );
}

export function disableDeploy(): HandleCommand<ToggleDeployEnablementParameters> {
    return commandHandlerFrom(
        toggleEnablement(false),
        ToggleDeployEnablementParameters,
        "DisableDeploy",
        "Disable deployment via Atomist SDM",
        "disable deploy",
    );
}
