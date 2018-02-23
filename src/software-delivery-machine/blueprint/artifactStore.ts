import { GitHubReleaseArtifactStore } from "../../handlers/events/delivery/artifact/github/GitHubReleaseArtifactStore";
import { LocalArtifactStore } from "../../handlers/events/delivery/artifact/local/LocalArtifactStore";

export const artifactStore = new LocalArtifactStore();//new GitHubReleaseArtifactStore();
