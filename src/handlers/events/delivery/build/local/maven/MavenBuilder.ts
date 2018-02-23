import { ProjectOperationCredentials } from "@atomist/automation-client/operations/common/ProjectOperationCredentials";
import { RemoteRepoRef } from "@atomist/automation-client/operations/common/RepoId";
import { GitCommandGitProject } from "@atomist/automation-client/project/git/GitCommandGitProject";
import { ChildProcess, spawn } from "child_process";
import { Readable } from "stream";
import { ArtifactStore } from "../../../ArtifactStore";
import { AppInfo } from "../../../deploy/Deployment";
import { InterpretedLog, LogInterpretation, LogInterpreter } from "../../../log/InterpretedLog";
import { LinkableLogFactory, LinkablePersistentProgressLog } from "../../../log/ProgressLog";
import { LocalBuilder, LocalBuildInProgress } from "../LocalBuilder";
import { identification } from "./pomParser";

/**
 * Build with Maven in the local automation client.
 * This implementation requires Java and maven on the classpath.
 * Note it is NOT intended for use for multiple organizations. It's OK
 * for one organization to use inside its firewall, but there is potential
 * vulnerability in builds of unrelated tenants getting at each others
 * artifacts.
 */
export class MavenBuilder extends LocalBuilder implements LogInterpretation {

    constructor(artifactStore: ArtifactStore, logFactory: LinkableLogFactory) {
        super(artifactStore, logFactory);
    }

    protected async startBuild(creds: ProjectOperationCredentials,
                               id: RemoteRepoRef,
                               team: string, log: LinkablePersistentProgressLog): Promise<LocalBuildInProgress> {
        const p = await GitCommandGitProject.cloned(creds, id);
        // Find the artifact info from Maven
        const pom = await p.findFile("pom.xml");
        const content = await pom.getContent();
        const va = await identification(content);
        const appId = {...va, name: va.artifact, id};
        const childProcess = spawn("mvn", [
            "package",
            "-DskipTests",
        ], {
            cwd: p.baseDir,
        });
        const buildResult = new Promise<{ error: boolean, code: number }>((resolve, reject) => {
            childProcess.stdout.on("data", data => {
                log.write(data.toString());
            });
            childProcess.addListener("exit", (code, signal) => {
                resolve({error: false, code});
            });
            childProcess.addListener("error", (code, signal) => {
                resolve({error: true, code});
            });
        });
        const rb = new UpdatingBuild(id, buildResult, team, log.url);
        rb.ai = appId;
        rb.deploymentUnitFile = `${p.baseDir}/target/${appId.name}-${appId.version}.jar`;
        return rb;
    }

    public logInterpreter(log: string): InterpretedLog | undefined {
        const relevantPart = log.split("\n")
            .filter(l => l.startsWith("[ERROR]"))
            .join("\n");
        return {
            relevantPart,
            message: "Maven errors",
            includeFullLog: true,
        };
    }

}

class UpdatingBuild implements LocalBuildInProgress {

    constructor(public repoRef: RemoteRepoRef,
                public buildResult: Promise<{error: boolean, code: number}>,
                public team: string,
                public url: string) {
    }

    public ai: AppInfo;

    public deploymentUnitFile: string;

    get appInfo(): AppInfo {
        return this.ai;
    }

}
