var URL = require('url')
var toPull = require('stream-to-pull-stream')
var SignalHub = require('signalhub')
var SimplePeer = require('simple-peer')
var wrtc = require('wrtc')
var cuid = require('cuid')

module.exports = function (opts) {
  opts = opts || {}

  var uuid = cuid()
  var sbot = opts.server
  var serverOnConnect = undefined

  var connectedServerPeers = []
  var connectedHubs = []

  sbot.on('RTC_HUB_ADDED', data => CreateServerPeer(data, opts))

  return {
    name: 'rtc',
    server: function (onConnect) {
      serverOnConnect = onConnect
      console.log(onConnect)

      return closeServer
    },
    client: function (addr, cb) {
      var hub = Hub(addr.hostname)
      connectedHubs.push(hub)
      var client = new SimplePeer({ wrtc, initiator: true })
      client.uuid = uuid

      hub.subscribe('signal')
        .on('data', function (data) {
          if (data.from !== client.uuid && !data.initiator) { client.signal(data.data) }
        })

      client.on('signal', function (data) {
        var wrapped = Object.assign({}, {from: client.uuid, initiator: true}, {data})

        hub.subscribe(client.uuid)
          .on('data', function (data) {
            client.signal(data)
          })

        hub.broadcast('signal', wrapped)
      })

      client.on('connect', function () {
        console.log('RTC client connected to a remote peer')
        var stream = toPull.duplex(client)
        stream.address = 'rtc:' + client.remoteAddress + ':' + client.remotePort
        hub.close()
        cb(null, stream)
      })

      return () => {
        // server.destroy()
        hub.close()
        cb(new Error('multiserver.rtc: aborted'))
      }
    },
    stringify: function () {
      var port
      // if (opts.server) { port = opts.server.address().port } else { port = opts.port }

      // TODO: ports?
      return URL.format({
        protocol: 'rtc',
        slashes: true,
        hostname: opts.host || 'localhost', // detect ip address
        port: port || 3483
      })
    },
    parse: function (str) {
      var addr = URL.parse(str)
      if (!/^rtc?\:$/.test(addr.protocol)) return null
      return addr
    }
  }

  function CreateServerPeer (hubAddress, opts) {
    if (!serverOnConnect) { return }

    var hub = Hub(hubAddress)
    connectedHubs.push(hub)

    var server = new SimplePeer({ wrtc })
    server.uuid = uuid
    connectedServerPeers.push(server)

    hub.subscribe('signal')
      .on('data', function (data) {
        if (data.from !== server.uuid && data.initiator) {
          server.signal(data.data)
        }
      })

    server.on('signal', function (data) {
      var wrapped = Object.assign({}, {from: server.uuid}, {data})
      hub.subscribe(server.uuid)
        .on('data', function (data) {
          server.signal(data)
        })
      hub.broadcast('signal', wrapped)
    })

    server.on('connect', function () {
      var stream = toPull.duplex(server)
      var hubUrl = hub.urls[0] // assumes hubs only have one url

      stream.address = 'rtc:' + server.remoteAddress + ':' + server.remotePort
      stream.protocol = 'rtc'
      stream.hub = URL.parse(hubUrl).hostname //this is yuck. Because of multiserver address pattern we need to prune off https. This is one place to do it but a bit fragile

      serverOnConnect(stream)
      hub.close()
      hub = Hub(hubUrl)

      //avoid stack overflow
      setTimeout(() => {
        CreateServerPeer(hubAddress, opts)
      }, 1)
    })
  }

  function closeServer () {
    connectedHubs
      .filter(hub => !hub.closed)
      .forEach(hub => hub.close())

    connectedServerPeers
      .forEach(peer => peer.destroy())
  }
}

function Hub (hub) {
  return SignalHub('sbot-rtc', 'https://' + hub)
}
