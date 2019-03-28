import { createHash } from "crypto";
import * as fs from "fs";
import * as fsPromises from "fs-extra";
import * as he from "he";
import Mustache from "mustache";
import * as parse5 from "parse5";
import * as path from "path";
import * as url from "url";
import Archive from "./archive";
import download from "./dl";
import * as rss from "./rss";

/**
 * An object where the keys are values from some ID space and values (if they
 * exist) are always true.
 */
interface IdSet {
  [id: string]: true;
}

/** The raw string value of a snapshotted RSS feed. */
type RawSnapshot = any;

/** The parsed XML of a snapshotted RSS feed. */
type XmlSnapshot = any;

/**
 * A locally cached podcast feed.
 *
 * A feed is composed of several components:
 *
 *  (1) A unique file-system-safe name.
 *
 *  (2) Locally cached snapshots of the tracked podcast's RSS feed. Only
 *      snapshots that define unique episodes are stored.
 *
 *  (3) Cached media files. Media files are identified by the <guid> tag in the
 *      RSS feed. On disk MP3 files are named after the hash of this guid value.
 *
 *  (4) A local RSS feed that is generated from all of the cached RSS snapshots.
 *      It contains the episodes from each snapshot and the channel-level
 *      meta-data from the latest snapshot.
 *
 *  (5) An HTML file that provides a web interface to the cached media.
 */
export default class Feed {

  /** Loads a feed from disk. */
  public static async load(db: Archive, name: string): Promise<Feed> {
    const feedUrl = await
        fsPromises.readFile(path.join(db.path, name, Feed.PATH_FEED_URL));
    return new Feed(db, name, feedUrl.toString());
  }

  /** Creates a new feed in the archive that tracks a given URL. */
  public static async create(
      db: Archive, name: string, feedUrl: string): Promise<Feed> {
    const feedPath = path.join(db.path, name);
    const urlFile = path.join(db.path, name, Feed.PATH_FEED_URL);
    await fsPromises.stat(feedPath)
        .then(
          () => {throw new Error((`Feed ${name} already exists`)); },
          () => null);
    await fsPromises.ensureDir(feedPath);
    await fsPromises.ensureDir(path.join(feedPath, Feed.PATH_CONFIG));
    await fsPromises.writeFile(urlFile, feedUrl);
    return new Feed(db, name, feedUrl);
  }

  /**
   * The path to the directory containing locally cached audio files.
   */
  private static readonly PATH_AUDIO = "audio";

  /**
   * The path relative to the feed root for config files and directories.
   */
  private static readonly PATH_CONFIG = "config";

  /**
   * The path relative to the feed root for the config file that stores the
   * content of the tracked RSS feed URL.
   */
  private static readonly PATH_FEED_URL =
      path.join(Feed.PATH_CONFIG, "feed.url");

  /**
   * The path to the directory containing locally cached images.
   */
  private static readonly PATH_IMAGES = "images";

  /**
   * The path to the generated HTML file providing the web UI.
   */
  private static readonly PATH_INDEX_HTML = "index.html";

  /**
   * The path to the generated RSS feed.
   */
  private static readonly PATH_RSS = "feed.xml";

  /**
   * The path to the directory containing the RSS feed snapshots.
   */
  private static readonly PATH_SNAPSHOTS = "snapshots";

  /**
   * The path to the mustache template file that is inflated to the generated
   * feed index HTML file.
   */
  private static readonly TEMPLATE = "templates/feed.html";

  public readonly name: string;
  /** The URL of the tracked podcast feed. */
  public readonly url: string;
  /** The URL of the locally generated RSS feed. */
  public readonly localUrl: string;

  private readonly db: Archive;
  /** The URL that points to the root of this feed's directory. */
  private readonly localUrlBase: string;

  constructor(db: Archive, name: string, feedUrl: string) {
    this.db = db;
    this.name = name;
    this.url = feedUrl;
    this.localUrlBase = `${db.baseUrl}/${this.name}`;
    this.localUrl = `${this.localUrlBase}/${Feed.PATH_RSS}`;
  }

  /**
   * Generate the HTML interface for this feed.
   */
  public async updateHtml(channel?: rss.Channel): Promise<void> {
    channel = channel || await this.generatedChannel();
    const template = await fsPromises
        .readFile(this.db.dbPath(Archive.PATH_CONFIG, Feed.TEMPLATE))
        .catch((e) => fsPromises.readFile(Feed.TEMPLATE));
    const view = {
      ...this.baseMustacheView(),
      channel,
    };
    const inflated = Mustache.render(template.toString(), view);
    await fsPromises.writeFile(this.feedPath(Feed.PATH_INDEX_HTML), inflated);
  }

  /**
   * Updates the feed by fetching a new snapshot and downloading any new media
   * files.
   */
  public async update(justMp3s = false) {
    if (!justMp3s) {
      try {
        await this.fetchSnapshot();
      } catch (e) {
        console.log(`Unable to fetch RSS feed for ${this.name}: ${e}`);
      }
    }
    const images: rss.Image[] = [];
    const channel = await this.generatedChannel(images);
    await this.fetchAudio(channel);
    await this.fetchImages(images);
    await this.saveFeed(channel);
  }

  /**
   * Returns the generated channel definition for this feed.
   *
   * The generated channel includes episodes from all of the locally cached feed
   * snapshots.
   *
   * Takes an optional argument which accumulates images referenced in the
   * generated channel.
   */
  public async generatedChannel(
      maybeImages?: rss.Image[]): Promise<rss.Channel> {
    const snapshots = await this.xmlSnapshots();
    const channel = this.channelMetaFromSnapshot(snapshots[0]);
    const allItems = ([] as rss.Item[]).concat(
        ...snapshots.map((x) => this.itemsFromSnapshot(x)));
    channel.items = this.uniquifyItems(allItems);
    const images = maybeImages || [];
    if (channel.image) {
      images.push(channel.image);
    }
    channel.items.forEach((item) => {
      item.description = this.sanitizeHtml(item.description, images);
    });
    return channel;
  }

  private sanitizeHtml(html: string | string[], images: rss.Image[]): string {
    if (html instanceof Array) {
      html = html[0] || "";
    }
    const doc = parse5.parseFragment(html);
    this.sanitizeElement(doc as parse5.DefaultTreeDocumentFragment, images);
    return parse5.serialize(doc);
  }

  private sanitizeElement(element: any, images: rss.Image[]) {
    if (element.attrs) {
      const allowedAttributes: {[attr: string]: boolean} = {
        alt: true,
        height: true,
        href: true,
        rel: true,
        src: true,
        target: true,
        title: true,
        width: true,
      };
      element.attrs =
          element.attrs.filter((attr: any) => allowedAttributes[attr.name]);
    }

    if (element.nodeName === "img" && element.attrs) {
      element.attrs
          .filter((attr: any) => attr.name === "src")
          .forEach((src: any) => {
            const image = this.imageFromUrl(src.value);
            images.push(image);
            src.value = image.localUrl;
          });
    }

    if (element.childNodes) {
      const allowedTags: {[tag: string]: boolean} = {
        "#text": true,
        "a": true,
        "div": true,
        "em": true,
        "img": true,
        "p": true,
        "span": true,
        "strong": true,
      };
      element.childNodes =
          element.childNodes.filter((node: any) => allowedTags[node.nodeName]);
      element.childNodes.map((node: any) => this.sanitizeElement(node, images));
    }
  }

  /**
   * Return a set of archive-level variables that are exposed to all mustache
   * templates.
   */
  private baseMustacheView() {
    return {
      ...this.db.baseMustacheView(),
      feedBaseUrl: this.localUrlBase,
      feedUrl: this.localUrl,
      name: this.name,
    };
  }

  private async saveFeed(channel: rss.Channel) {
    await fsPromises.writeFile(
      this.feedPath(Feed.PATH_RSS),
      rss.toXml(channel));
  }

  private async fetchSnapshot(): Promise<any> {
    const snapshotPath = await this.nextSnapshotPath();
    // Used as the validator to only save snapshots if the provide new unique
    // content. This prevents the explosion of saved snapshots and allows for
    // snapshots to be fetched at frequent intervals.
    const isNewSnapshot = async (tmpPath: string) => {
      const hash = (s: rss.Channel) => this.channelHash(s);
      const oldHashes = (await this.channelSnapshots()).map(hash);
      const newHash = await fsPromises.readFile(tmpPath)
          .then((s) => hash(this.channelFromSnapshot(s.toString())));
      return oldHashes.filter((oldHash) => oldHash === newHash).length === 0;
    };
    const isNew = await download(
        `${this.name} RSS feed`, this.url, snapshotPath, isNewSnapshot);
    if (isNew) {
      console.log(`Change detected in RSS feed of ${this.name}.`);
    }
  }

  private async snapshotPaths(): Promise<string[]> {
    const compareSnapshotFiles = (a: string, b: string) => {
      // Extract the timestamp from the file names.
      const aValue = parseInt(a.split(".")[0], 10);
      const bValue = parseInt(b.split(".")[0], 10);
      return bValue - aValue;
    };
    return (await this.filesUnder(this.feedPath(Feed.PATH_SNAPSHOTS)))
        .sort(compareSnapshotFiles)
        .map((name) => this.feedPath(Feed.PATH_SNAPSHOTS, name));
  }

  private async nextSnapshotPath(): Promise<string> {
    await fsPromises.ensureDir(this.feedPath(Feed.PATH_SNAPSHOTS));
    return this.feedPath(Feed.PATH_SNAPSHOTS, `${Date.now()}.xml`);
  }

  private uniquifyItems(items: rss.Item[]): rss.Item[] {
    const guids: IdSet = {};
    const filteredItems: rss.Item[] = [];
    items.forEach((item) => {
      if (guids[item.guid]) {
        return;
      }

      guids[item.guid] = true;
      filteredItems.push(item);
    });
    const compareDates = (a: rss.Item, b: rss.Item) => b.pubDate - a.pubDate;
    return filteredItems.sort(compareDates);
  }

  private async fetchImages(images: rss.Image[]) {
    await fsPromises.ensureDir(this.feedPath(Feed.PATH_IMAGES));

    for (const image of images) {
      const imageExists = await fsPromises
          .stat(image.localPath)
          .then(() => true, () => false);
      if (imageExists) {
        continue;
      }

      await download(
          `${this.name} artwork`,
          image.remoteUrl,
          image.localPath);
    }
  }

  private async fetchAudio(channel: rss.Channel) {
    await fsPromises.ensureDir(this.feedPath(Feed.PATH_AUDIO));
    const guids = await this.existingGuidHashes();
    const items = await channel.items
        .filter((item) => !guids[this.hash(item.guid)]);

    for (const item of items) {
      await download(
        `${this.name} - ${item.title}`,
        item.enclosure.remoteUrl,
        item.enclosure.localPath);
    }
  }

  /**
   * Returns list of the hashed GUID values for the already downloaded audio
   * files.
   */
  private async existingGuidHashes(): Promise<IdSet> {
    const hashes =
        (await this.filesUnder(this.feedPath(Feed.PATH_AUDIO)))
            .map((name) => name.split(".")[0]);
    const x: IdSet = {};
    hashes.forEach((hash) => { x[hash] = true; });
    return Promise.resolve(x);
  }

  private hash(guid: string) {
    try {
      return createHash("sha1").update(guid.toString()).digest("hex");
    } catch (e) {
      console.log(`Unable to hash GUID ${guid}:`, e);
      throw e;
    }
  }

  /**
   * Hashes a channel such that two channels have the same hash IFF they provide
   * the exact same set of episodes (as determined by their GUID).
   */
  private channelHash(channel: rss.Channel): string {
    return this.hash(channel.items.map((item) => item.guidHash).join(":"));
  }

  /**
   * Returns a complete channel definition from a single XML snapshot.
   */
  private channelFromSnapshot(snapshot: string): rss.Channel {
    const xml = rss.fromXml(snapshot);
    return {
      ...this.channelMetaFromSnapshot(xml),
      items: this.itemsFromSnapshot(xml),
    };
  }

  /**
   * Returns a channel definition from an XML snapshot excluding any episodes.
   */
  private channelMetaFromSnapshot(snapshot: XmlSnapshot): rss.Channel {
    const parseDate = (date: string) => {
      try {
        return Date.parse(date);
      } catch (e) {
        return 0;
      }
    };

    const itunesOwner = snapshot.rss.channel["itunes:owner"];
    let owner;
    if (itunesOwner &&
        itunesOwner["itunes:name"] &&
        itunesOwner["itunes:email"]) {
      owner = {
        email: itunesOwner["itunes:email"],
        name: itunesOwner["itunes:name"],
      };
    }

    const imageRemoteUrl =
        (snapshot.rss.channel.image || {}).url ||
        (snapshot.rss.channel["itunes:image"] || {})["@_href"];
    let image;
    if (imageRemoteUrl) {
      image = this.imageFromUrl(imageRemoteUrl);
    }
    return {
      author: snapshot.rss.channel["itunes:author"],
      copyright: snapshot.rss.channel.copyright,
      description: snapshot.rss.channel.description,
      image,
      items: [],
      language: snapshot.rss.channel.language,
      lastBuildDate: parseDate(snapshot.rss.channel.lastBuildDate),
      link: snapshot.rss.channel.link,
      owner,
      pubDate: parseDate(snapshot.rss.channel.pubDate),
      title: snapshot.rss.channel.title,
    };
  }

  private imageFromUrl(remoteUrl: string): rss.Image {
    const localName = `${this.hash(remoteUrl)}`;
    return {
      localPath: this.feedPath(Feed.PATH_IMAGES, localName),
      localUrl: `${this.localUrlBase}/${Feed.PATH_IMAGES}/${localName}`,
      remoteUrl,
    };
  }

  /**
   * Returns a list of items that are provided by an Xml snapshot.
   */
  private itemsFromSnapshot(snapshot: XmlSnapshot): rss.Item[] {
    return (snapshot.rss.channel.item || []).map((item: any) => {
      const ext = path.extname(new url.URL(item.enclosure["@_url"]).pathname) ||
                 ".mp3";
      const guid = item.guid["#text"] || item.guid;
      const guidHash = this.hash(guid);
      const localName = `${guidHash}${ext}`;
      return {
        description: item["content:encoded"] || item.description,
        enclosure: {
          length: item.enclosure["@_length"],
          localPath: this.feedPath(Feed.PATH_AUDIO, localName),
          localUrl: `${this.localUrlBase}/${Feed.PATH_AUDIO}/${localName}`,
          remoteUrl: item.enclosure["@_url"],
          type: item.enclosure["@_type"],
        },
        guid,
        guidHash,
        link: item.link,
        pubDate: Date.parse(item.pubDate),
        pubDateAsString:
            new Date(Date.parse(item.pubDate)).toDateString(),
        title: item.title,
      };
    });
  }

  /**
   * Returns a list of channel definitions derived from each snapshot in
   * isolation.
   */
  private async channelSnapshots(): Promise<rss.Channel[]> {
    return (await this.rawSnapshots()).map((s) => this.channelFromSnapshot(s));
  }

  /**
   * Returns a list of parsed XML documents corresponding to the snapshoted RSS
   * feeds.
   */
  private async xmlSnapshots(): Promise<XmlSnapshot[]> {
    return (await this.rawSnapshots()).map(rss.fromXml);
  }

  /**
   * Returns a list of the raw snapshoted RSS feeds.
   */
  private async rawSnapshots(): Promise<RawSnapshot[]> {
    const readSnapshot = (snapshotPath: string) =>
        fsPromises.readFile(snapshotPath)
            .then((x) => x.toString());
    return this.snapshotPaths()
        .then((paths) => Promise.all(paths.map(readSnapshot)));
  }

  /**
   * Returns all the (non pending download) files in a given directory.
   */
  private async filesUnder(root: string): Promise<string[]> {
    const dirents = await fsPromises.readdir(
        root, {withFileTypes: true} as any);
    return (dirents as unknown as fs.Dirent[])
        .filter((d) => d.isFile())
        .map((d) => d.name)
        .filter((name) => !name.endsWith(".download"));
  }

  private feedPath(...subDirs: string[]) {
    return path.join(this.db.path, this.name, ...subDirs);
  }
}
