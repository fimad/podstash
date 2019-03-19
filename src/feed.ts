import * as crypto from "crypto";
import * as fs from "fs";
import { promises as fsPromises } from "fs";
import * as path from "path";
import DataBase from "./db";
import download from "./dl";
import * as rss from "./rss";

interface IdSet {
  [id: string]: boolean;
}

export default class Feed {

  public static async load(db: DataBase, name: string): Promise<Feed> {
    const url = await
        fsPromises.readFile(path.join(db.path, name, Feed.PATH_FEED_URL));
    return new Feed(db, name, url.toString());
  }

  public static async create(db: DataBase, name: string, url: string): Promise<Feed> {
    const feedPath = path.join(db.path, name);
    const urlFile = path.join(db.path, name, Feed.PATH_FEED_URL);
    await fsPromises.stat(feedPath)
        .then(
          () => {throw new Error((`Feed ${name} already exists`)); },
          () => null);
    await fsPromises.mkdir(feedPath);
    await fsPromises.writeFile(urlFile, url);
    return new Feed(db, name, url);
  }

  private static readonly PATH_AUDIO = "audio";
  private static readonly PATH_FEED_URL = "feed.url";
  private static readonly PATH_RSS = "feed.xml";
  private static readonly PATH_SNAPSHOTS = "snapshots";
  public readonly name: string;
  public readonly url: string;
  public readonly localUrl: string;

  private readonly db: DataBase;
  private readonly localUrlBase: string;

  constructor(db: DataBase, name: string, url: string) {
    this.db = db;
    this.name = name;
    this.url = url;
    this.localUrlBase = `${db.baseUrl}/${this.name}`;
    this.localUrl = `${this.localUrlBase}/${Feed.PATH_RSS}`;
  }

  public async fetchSnapshot(): Promise<any> {
    const snapshotPath = await this.nextSnapshotPath();
    return download(`${this.name} RSS feed`, this.url, snapshotPath);
  }

  public async channel(): Promise<rss.Channel> {
    const snapshots = await this.snapshots();
    const channel = this.channelFromSnapshot(snapshots[0]);
    const allItems = ([] as rss.Item[]).concat(
        ...snapshots.map((x) => this.itemsFromSnapshot(x)));
    channel.items = this.uniquifyItems(allItems);
    return channel;
  }

  public async update() {
    await this.fetchSnapshot();
    const channel = await this.channel();
    await this.fetchAudio(channel);
    await this.saveFeed(channel);
  }

  public async saveFeed(channel?: rss.Channel) {
    channel = channel || await this.channel();
    await fsPromises.writeFile(
      this.feedPath(Feed.PATH_RSS),
      rss.toXml(channel));
  }

  public async fetchAudio(channel?: rss.Channel) {
    await fsPromises.mkdir(this.feedPath(Feed.PATH_AUDIO), {recursive: true});
    channel = channel || await this.channel();
    const guids = await this.guidHashes();
    const items = await channel.items
        .filter((item) => !guids[this.hashGuid(item.guid)]);
    await this.fetchNextAudio(items);
  }

  public async snapshotPaths(): Promise<string[]> {
    const compareSnapshotFiles = (a: string, b: string) => {
      // Extract the timestamp from the file names.
      const aValue = parseInt(a.split(".")[0], 10);
      const bValue = parseInt(b.split(".")[0], 10);
      return bValue - aValue;
    };
    const root = this.feedPath(Feed.PATH_SNAPSHOTS);
    const dirents = await fsPromises.readdir(root, {withFileTypes: true} as any);
    return (dirents as unknown as fs.Dirent[])
        .filter((d) => d.isFile())
        .map((d) => d.name)
        .sort(compareSnapshotFiles)
        .map((name) => this.feedPath(Feed.PATH_SNAPSHOTS, name));
  }

  private async nextSnapshotPath(): Promise<string> {
    await fsPromises
        .mkdir(this.feedPath(Feed.PATH_SNAPSHOTS), {recursive: true});
    return this.feedPath(Feed.PATH_SNAPSHOTS, `${Date.now()}.xml`);
  }

  private feedPath(...subDirs: string[]) {
    return path.join(this.db.path, this.name, ...subDirs);
  }

  private async guidHashes(): Promise<IdSet> {
    const root = this.feedPath(Feed.PATH_AUDIO);
    const dirents =
        await fsPromises.readdir(root, {withFileTypes: true} as any);
    const hashes = (dirents as unknown as fs.Dirent[])
        .filter((d) => d.isFile())
        .filter((d) => !d.name.endsWith(".download"))
        .map((d) => d.name.split(".")[0]);
    const x: IdSet = {};
    hashes.forEach((hash) => { x[hash] = true; });
    return Promise.resolve(x);
  }

  private async fetchNextAudio(items: rss.Item[]) {
    for (const nextAudio of items) {
      await download(
        `${this.name} - ${nextAudio.title}`,
        nextAudio.enclosure.remoteUrl,
        nextAudio.enclosure.localPath);
    }
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

  private hashGuid(guid: string) {
    try {
      return crypto.createHash("sha1").update(guid.toString()).digest("hex");
    } catch (e) {
      console.log(`Unable to hash GUID ${guid}:`, e);
      throw e;
    }
  }

  private channelFromSnapshot(snapshot: any): rss.Channel {
    const parseDate = (date: string) => {
      try {
        return Date.parse(date);
      } catch (e) {
        return 0;
      }
    };
    return {
      description: snapshot.rss.channel.description,
      items: [],
      language: snapshot.rss.channel.language,
      lastBuildDate: parseDate(snapshot.rss.channel.lastBuildDate),
      link: snapshot.rss.channel.link,
      pubDate: parseDate(snapshot.rss.channel.pubDate),
      title: snapshot.rss.channel.title,
    };
  }

  private itemsFromSnapshot(snapshot: any): rss.Item[] {
    return (snapshot.rss.channel.item || []).map((item: any) => {
      const ext = path.extname(item.enclosure["@_url"]);
      const guid = item.guid["#text"] || item.guid;
      const guidHash = this.hashGuid(guid);
      const localName = `${guidHash}${ext}`;
      return {
        description: item.description,
        enclosure: {
          localPath: this.feedPath(Feed.PATH_AUDIO, localName),
          localUrl: `${this.localUrlBase}/${Feed.PATH_AUDIO}/${localName}`,
          remoteUrl: item.enclosure["@_url"],
          type: item.enclosure["@_type"],
        },
        guid,
        link: item.link,
        pubDate: Date.parse(item.pubDate),
        title: item.title,
      };
    });
  }

  private snapshots(): Promise<any[]> {
    const readSnapshot = (snapshotPath: string) =>
        fsPromises.readFile(snapshotPath)
            .then((x) => x.toString())
            .then(rss.fromXml);
    return this.snapshotPaths()
        .then((paths) => Promise.all(paths.map(readSnapshot)));
  }
}
