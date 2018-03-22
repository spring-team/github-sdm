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

import { onAnyPush, whenPushSatisfies } from "../../blueprint/ruleDsl";
import { SoftwareDeliveryMachine, SoftwareDeliveryMachineOptions } from "../../blueprint/SoftwareDeliveryMachine";
import { MavenBuilder } from "../../common/delivery/build/local/maven/MavenBuilder";
import { NpmBuilder } from "../../common/delivery/build/local/npm/NpmBuilder";
import { NoGoals } from "../../common/delivery/goals/common/commonGoals";
import { HttpServiceGoals, LocalDeploymentGoals } from "../../common/delivery/goals/common/httpServiceGoals";
import { LibraryGoals } from "../../common/delivery/goals/common/libraryGoals";
import { NpmBuildGoals } from "../../common/delivery/goals/common/npmGoals";
import { FromAtomist, ToDefaultBranch, ToPublicRepo } from "../../common/listener/support/pushtest/commonPushTests";
import { IsDeployEnabled } from "../../common/listener/support/pushtest/deployPushTests";
import { HasSpringBootApplicationClass, IsMaven } from "../../common/listener/support/pushtest/jvm/jvmPushTests";
import { MaterialChangeToJavaRepo } from "../../common/listener/support/pushtest/jvm/materialChangeToJavaRepo";
import { NamedSeedRepo } from "../../common/listener/support/pushtest/NamedSeedRepo";
import { IsNode } from "../../common/listener/support/pushtest/node/nodePushTests";
import { HasCloudFoundryManifest } from "../../common/listener/support/pushtest/pcf/cloudFoundryManifestPushTest";
import { not } from "../../common/listener/support/pushtest/pushTestUtils";
import { createEphemeralProgressLog } from "../../common/log/EphemeralProgressLog";
import { lookFor200OnEndpointRootGet } from "../../common/verify/lookFor200OnEndpointRootGet";
import { disableDeploy, enableDeploy } from "../../handlers/commands/SetDeployEnablement";
import { CloudFoundryProductionDeploy } from "../blueprint/deploy/cloudFoundryDeploy";
import { LocalExecutableJarDeploy } from "../blueprint/deploy/localSpringBootDeployOnSuccessStatus";
import { suggestAddingCloudFoundryManifest } from "../blueprint/repo/suggestAddingCloudFoundryManifest";
import { addCloudFoundryManifest } from "../commands/editors/pcf/addCloudFoundryManifest";
import { addDemoEditors } from "../parts/demo/demoEditors";
import { addJavaSupport, JavaSupportOptions } from "../parts/stacks/javaSupport";
import { addNodeSupport } from "../parts/stacks/nodeSupport";
import { addSpringSupport } from "../parts/stacks/springSupport";
import { addTeamPolicies } from "../parts/team/teamPolicies";

export type CloudFoundrySoftwareDeliverMachineOptions = SoftwareDeliveryMachineOptions & JavaSupportOptions;

/**
 * Assemble a machine that supports Java, Spring and Node and deploys to Cloud Foundry
 * @return {SoftwareDeliveryMachine}
 */
export function cloudFoundrySoftwareDeliveryMachine(options: CloudFoundrySoftwareDeliverMachineOptions): SoftwareDeliveryMachine {
    const sdm = new SoftwareDeliveryMachine(options,
        whenPushSatisfies(IsMaven, HasSpringBootApplicationClass, not(FromAtomist), not(MaterialChangeToJavaRepo))
            .itMeans("No material change to Java")
            .setGoals(NoGoals),
        whenPushSatisfies(ToDefaultBranch, IsMaven, HasSpringBootApplicationClass, HasCloudFoundryManifest,
            ToPublicRepo, not(NamedSeedRepo), IsDeployEnabled)
            .itMeans("Spring Boot service to deploy")
            .setGoals(HttpServiceGoals),
        whenPushSatisfies(IsMaven, HasSpringBootApplicationClass, not(FromAtomist))
            .itMeans("Spring Boot service local deploy")
            .setGoals(LocalDeploymentGoals),
        whenPushSatisfies(IsMaven, MaterialChangeToJavaRepo)
            .itMeans("Build Java")
            .setGoals(LibraryGoals),
        whenPushSatisfies(IsNode)
            .itMeans("Build with npm")
            .setGoals(NpmBuildGoals)
            .buildWith(new NpmBuilder(options.artifactStore, createEphemeralProgressLog, options.projectLoader)),
        onAnyPush.buildWith(new MavenBuilder(options.artifactStore, createEphemeralProgressLog, options.projectLoader)),
    );

    sdm.addDeployers(
        LocalExecutableJarDeploy,
        CloudFoundryProductionDeploy,
    )
        .addNewRepoWithCodeActions(suggestAddingCloudFoundryManifest)
        .addSupportingCommands(
            () => addCloudFoundryManifest,
            () => enableDeploy(),
            () => disableDeploy(),
        )
        .addEndpointVerificationListeners(lookFor200OnEndpointRootGet());

    addJavaSupport(sdm, options);
    addSpringSupport(sdm, options);
    addNodeSupport(sdm);
    addTeamPolicies(sdm);
    addDemoEditors(sdm);
    return sdm;
}