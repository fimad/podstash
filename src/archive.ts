import * as fs from "fs";
import { promises as fsPromises } from "fs";
import Mustache from "mustache";
import * as path from "path";
import * as lockfile from "proper-lockfile";
import * as frequest from "request-promise-native";
import Feed from "./feed";
import * as rss from "./rss";

/**
 * A podcast archive.
 *
 * An archive is a directory on disk that contains several podcast feeds that
 * are tracked and cached locally. The archive maintains cross-feed
 * configuration values and provides an API for accessing the constituent feeds.
 *
 * The archive is structured on disk in such that it can be exposed over HTTP.
 * The locally cached feeds expose an HTML interface and a generated feed
 * composed of the constituent cached RSS feeds.
 *
 * The base URL of an archive is the URL under which the archive is exposed.
 */
export default class Archive {

  /** Loads an archive from disk. */
  public static async load(
      dbPath: string,
      withArchive: (archive: Archive) => Promise<any>) {
    const baseUrlPath = path.join(dbPath, Archive.PATH_BASE_URL);
    Archive.doWithLockedArchive(
        dbPath,
        () => fsPromises.readFile(baseUrlPath).then((x) => x.toString()),
        withArchive);
  }

  /** Creates a new archive on disk. */
  public static async create(
      dbPath: string,
      baseUrl: string,
      withArchive: (archive: Archive) => Promise<any>) {
    const baseUrlPath = path.join(dbPath, Archive.PATH_BASE_URL);
    Archive.doWithLockedArchive(
        dbPath,
        async () => {
          await fsPromises.writeFile(baseUrlPath, baseUrl);
          return baseUrl;
        },
        withArchive);
  }

  /**
   * The path relative to the archive root for the config file that stores the
   * content of the base URL.
   */
  private static readonly PATH_BASE_URL = "base.url";

  /**
   * The path relative to the archive root for the generated index.html file.
   */
  private static readonly PATH_INDEX_HTML = "index.html";

  /**
   * The path to the mustache template file that is inflated to the generated
   * archive index HTML file.
   */
  private static readonly TEMPLATE = "templates/index.html";

  private static async doWithLockedArchive(
      dbPath: string,
      getBaseUrl: () => Promise<string>,
      withArchive: (archive: Archive) => Promise<any>) {
    await fsPromises.mkdir(dbPath, {recursive: true});
    await fsPromises.stat(dbPath);
    const lockPath = path.join(dbPath, Archive.PATH_LOCK_FILE);
    try {
      const release = await lockfile.lock(dbPath);
      try {
        const baseUrl = await getBaseUrl();
        await withArchive(new Archive(dbPath, baseUrl.toString()));
      } finally {
        await release();
      }
    } catch (e) {
      console.log("Unable to acquire lock on archive.");
      console.log("Is another instance running?");
      throw(e);
    }
  }

  /**
   * The path under which podcasts and their associated meta data will be
   * stored.
   */
  public readonly path: string;

  /**
   * The base URL under which the mirrored podcasts are made available. This is
   * used when generating the mirrored RSS/XML files.
   */
  public readonly baseUrl: string;

  constructor(dbPath: string, baseUrl: string) {
    this.path = dbPath;
    this.baseUrl = baseUrl;
  }

  /** Return a list of feeds in the archive. */
  public feeds(): Promise<Feed[]> {
    return fsPromises.readdir(this.path, {withFileTypes: true} as any)
        .then((dirents) => Promise.all((dirents as unknown as fs.Dirent[])
            .filter((d) => d.isDirectory())
            .sort()
            .map((d) => Feed.load(this, d.name))));
  }

  /**
   * Add a new feed to the archive.
   *
   * The name should be unique and safe for file systems. The URL is the remote
   * RSS feed URL to be tracked.
   */
  public newFeed(name: string, url: string): Promise<Feed> {
    return Feed.create(this, name, url);
  }

  /**
   * Generate the HTML interface for managed feeds.
   */
  public async updateHtml(): Promise<void> {
    // nexe does not support the promise APIs. Read synchronously as a
    // workaround instead.
    const template = fs.readFileSync(Archive.TEMPLATE);
    const feeds = await this.feeds();
    const feedsAndChannels: Array<[Feed, rss.Channel]> = await Promise.all(
      feeds.map(async (feed) =>
          [feed, await feed.generatedChannel()] as [Feed, rss.Channel]));
    const channels = feedsAndChannels.map(([feed, channel]) => ({
      channel,
      name: feed.name,
    }));
    const view = {
      ...this.baseMustacheView(),
      channels,
    };
    const inflated = Mustache.render(template.toString(), view);
    await fsPromises.writeFile(this.dbPath(Archive.PATH_INDEX_HTML), inflated);
    await Promise.all(
        feedsAndChannels.map(([feed, channel]) => feed.updateHtml(channel)));
  }

  /**
   * Return a set of archive-level variables that are exposed to all mustache
   * templates.
   */
  public baseMustacheView() {
    return {
      baseUrl: this.baseUrl,
    };
  }

  private dbPath(...subDirs: string[]) {
    return path.join(this.path, ...subDirs);
  }
}
