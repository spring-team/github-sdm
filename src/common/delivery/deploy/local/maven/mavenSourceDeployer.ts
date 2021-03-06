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

import { logger } from "@atomist/automation-client";
import { ProjectOperationCredentials } from "@atomist/automation-client/operations/common/ProjectOperationCredentials";
import { LocalProject } from "@atomist/automation-client/project/local/LocalProject";
import { spawn } from "child_process";
import { DeployableArtifact } from "../../../../../spi/artifact/ArtifactStore";
import { Deployer } from "../../../../../spi/deploy/Deployer";
import { Deployment } from "../../../../../spi/deploy/Deployment";
import { InterpretedLog, LogInterpreter } from "../../../../../spi/log/InterpretedLog";
import { ProgressLog } from "../../../../../spi/log/ProgressLog";
import { ProjectLoader } from "../../../../repo/ProjectLoader";
import { ManagedDeployments, ManagedDeploymentTargetInfo } from "../appManagement";
import { DefaultLocalDeployerOptions, LocalDeployerOptions } from "../LocalDeployerOptions";

/**
 * Managed deployments
 */
let managedDeployments: ManagedDeployments;

/**
 * Use Maven to deploy
 * @param projectLoader use to load projects
 * @param opts options
 */
export function mavenDeployer(projectLoader: ProjectLoader, opts: LocalDeployerOptions): Deployer<ManagedDeploymentTargetInfo> {
    if (!managedDeployments) {
        logger.info("Created new deployments record");
        managedDeployments = new ManagedDeployments(opts.lowerPort);
    }
    return new MavenSourceDeployer(projectLoader, {
        ...DefaultLocalDeployerOptions,
        ...opts,
    });
}

class MavenSourceDeployer implements Deployer<ManagedDeploymentTargetInfo> {

    constructor(public projectLoader: ProjectLoader, public opts: LocalDeployerOptions) {
    }

    public findDeployments(da: DeployableArtifact, ti: ManagedDeploymentTargetInfo, creds: ProjectOperationCredentials): Promise<Deployment[]> {
        return managedDeployments.terminateIfRunning(ti.managedDeploymentKey);

    }

    public async deploy(da: DeployableArtifact,
                        ti: ManagedDeploymentTargetInfo,
                        log: ProgressLog,
                        credentials: ProjectOperationCredentials,
                        team: string): Promise<Deployment[]> {
        const id = da.id;
        const port = managedDeployments.findPort(ti.managedDeploymentKey);
        logger.info("Deploying app [%j],branch=%s on port [%d] for team %s", id, ti.managedDeploymentKey.branch, port, team);
        await managedDeployments.terminateIfRunning(ti.managedDeploymentKey);
        return Promise.all([
            this.projectLoader.doWithProject({credentials, id, readOnly: true}, project =>
                this.deployProject(ti, log, project, port, team))],
        );

    }

    private async deployProject(ti: ManagedDeploymentTargetInfo,
                                log: ProgressLog,
                                project: LocalProject,
                                port: number,
                                atomistTeam: string): Promise<Deployment> {
        const branchId = ti.managedDeploymentKey;
        const startupInfo = {
            port,
            atomistTeam,
            contextRoot: `/${branchId.owner}/${branchId.repo}/${branchId.branch}`,
        };

        // TODO switch to watchSpawned
        const childProcess = spawn("mvn",
            [
                "spring-boot:run",
            ].concat(this.opts.commandLineArgumentsFor(startupInfo)),
            {
                cwd: project.baseDir,
            });
        if (!childProcess.pid) {
            throw new Error("Fatal error deploying using Maven--is `mvn` on your automation node path?\n" +
                "Attempted to execute `mvn: spring-boot:run`");
        }
        childProcess.stdout.on("data", what => log.write(what.toString()));
        childProcess.stderr.on("data", what => log.write(what.toString()));
        return new Promise((resolve, reject) => {
            childProcess.stdout.addListener("data", what => {
                // TODO too Tomcat specific
                if (!!what && what.toString().includes("Tomcat started on port")) {
                    managedDeployments.recordDeployment({
                        id: branchId,
                        port, childProcess,
                    });
                    resolve({
                        endpoint: `${this.opts.baseUrl}:${port}/${startupInfo.contextRoot}`,
                    });
                }
            });
            childProcess.addListener("exit", () => {
                reject("We should have found Tomcat endpoint by now!!");
            });
            childProcess.addListener("error", reject);
        });
    }

    public logInterpreter(log: string): InterpretedLog | undefined {
        return springBootRunLogInterpreter(log) || shortLogInterpreter(log);
    }

}

const shortLogInterpreter: LogInterpreter = (log: string) => {
    if (log.length < 200) {
        return {
            relevantPart: log,
            message: "This is the whole log.",
            includeFullLog: false,
        };
    }
};

const springBootRunLogInterpreter: LogInterpreter = (log: string) => {
    logger.debug("Interpreting log");

    if (!log) {
        logger.warn("log was empty");
        return undefined;
    }

    const maybeFailedToStart = appFailedToStart(log);
    if (maybeFailedToStart) {
        return {
            relevantPart: maybeFailedToStart,
            message: "Application failed to start",
            includeFullLog: false,
        };
    }

    // default to maven errors
    const maybeMavenErrors = mavenErrors(log);
    if (maybeMavenErrors) {
        logger.info("recognized maven error");
        return {
            relevantPart: maybeMavenErrors,
            message: "Maven errors",
            includeFullLog: true,
        };
    }

    // or it could be this problem here
    if (log.match(/Error checking out artifact/)) {
        logger.info("Recognized artifact error");
        return {
            relevantPart: log,
            message: "I lost the local cache. Please rebuild",
            includeFullLog: false,
        };
    }

    logger.info("Did not find anything to recognize in the log");
};

function appFailedToStart(log: string) {
    const lines = log.split("\n");
    const failedToStartLine = lines.indexOf("APPLICATION FAILED TO START");
    if (failedToStartLine < 1) {
        return undefined;
    }
    const likelyLines = lines.slice(failedToStartLine + 3, failedToStartLine + 10);
    return likelyLines.join("\n");
}

function mavenErrors(log: string) {
    if (log.match(/^\[ERROR]/m)) {
        return log.split("\n")
            .filter(l => l.startsWith("[ERROR]"))
            .join("\n");
    }
}
