podstash
========

Have you ever lost a ~~loved one~~ podcast? Perhaps the author decided to stop
got bored or decided to stop paying for hosting.

Have you ever wanted to go back and listen to the first episode of a podcast
only to realize that the feed only contains the last 100 or even 50 episodes?

Are you a digital hoarder?

If you answered yes to any of the questions above, then podstash might be for
your.

Podstash tracks multiple podcast feeds and archives media files locally so that
you never have to worry about losing access again.

For each tracked podcast, podstash keeps a snapshot of all the observed versions
of the podcast's feed and the corresponding media files. It then combines the
historical feed snapshots into a single unified feed that references your
locally cached media and every episode from the podcast.

Along with the generated feeds podstash generates HTML files that provide an
interface for exploring and listing to your newly acquired MP3 hoard.

Installation
------------

You can install the latest version of podstash via npm:

```shell
npm install -g  podstash
```

You can also build locally using yarn:

```shell
git clone git@github.com:fimad/podstash.git
cd podstash
yarn build
./dist/podstash --help
```

Usage
-----

### Create An Archive

All of the podcasts tracked by podstash are stored in an archive. You can create
a new archive with the `podstash init` command.

```shell
podstash init --archive ./path/to/archive --base-url http://example.com
```

Podstash expects that your archive is exposed over HTTP, the URL that
corresponds to this is given in `--base-url`. If you haven't set up an HTTP
server, no worries, you can provide a made up value now and change it later.

### Track A Podcast

You use the `podcast add` command to start tracking a new podcast.

```shell
podstash add \
    --archive ./path/to/archive \
    --feed-url 'https://example.com/podcast/rss.xml' \
    --feed-name some-name
```

The name of the feed must be a unique and file system safe directory name.

### Update Your Archive

The `podstash update` command directs podstash to fetch new RSS snapshots,
download, audio files, and regenerate your mirrored RSS feed.

```shell
podstash update --archive ./path/to/archive
```

Customization
-------------

Podstash uses config files that are stored in the archive. If you change a
configuration file you must run `podstash update` for the changes to be
reflected in the generated feed/HTML.

### $archive/config/base.url

The URL that points to where the archive directory is exposed over HTTP. This is
the value provided via `--base-url` when initializing an archive.

### $archive/config/templates/index.html

A mustache template that is used to inflate the archive's index HTML file. This
file is optional and if it is not provided the default template will be used.

See the [default
template](https://github.com/fimad/podstash/blob/master/templates/index.html)
for an example.

### $archive/config/templates/feed.html

A mustache template that is used to inflate each podcast's index HTML file. This
file is optional and if it is not provided the default template will be used.

See the [default
template](https://github.com/fimad/podstash/blob/master/templates/feed.html)
for an example.

### $archive/$podcast/config/feed.url

The URL that points to the podcast's RSS feed. This is the value provided via
`--feed-url` when adding a new podcast to an archive.
