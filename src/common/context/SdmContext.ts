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

import { HandlerContext } from "@atomist/automation-client";
import { ProjectOperationCredentials } from "@atomist/automation-client/operations/common/ProjectOperationCredentials";
import { RemoteRepoRef } from "@atomist/automation-client/operations/common/RepoId";
import { AddressChannels } from "../slack/addressChannels";

/**
 * Context for an SDM action, whether a listener invocation or internal action
 */
export interface SdmContext {

    /**
     * The repo this relates to
     */
    id: RemoteRepoRef;

    /**
     * Context of the Atomist EventHandler invocation. Use to run GraphQL
     * queries, use the messageClient directly and find
     * the team and correlation id
     */
    context: HandlerContext;

    /**
     * If available, provides a way to address the channel(s) related to this repo.
     */
    addressChannels?: AddressChannels;

    /**
     * Credentials for use with source control hosts such as GitHub
     */
    credentials: ProjectOperationCredentials;

}
