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

import { Destination } from "@atomist/automation-client/spi/message/MessageClient";
import { StatusState } from "../../typings/types";
import { ListenerInvocation, SdmListener } from "./Listener";

export interface StatusInfo {
    state?: StatusState | null;
    targetUrl?: string | null;
    context?: string | null;
}

/**
 * Represents a verified deployment
 */
export interface VerifiedDeploymentInvocation extends ListenerInvocation {
    status: StatusInfo;
    messageDestination: Destination;
}

export type VerifiedDeploymentListener = SdmListener<VerifiedDeploymentInvocation>;
