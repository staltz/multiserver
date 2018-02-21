var URL = require('url')
var pull = require('pull-stream/pull')
var toPull = require('stream-to-pull-stream')
var Map = require('pull-stream/throughs/map')
var signalhub = require('signalhub')
var SimplePeer = require('simple-peer')
var wrtc = require('wrtc')
var cuid = require('cuid')



module.exports = function (opts) {
  opts = opts || {}
  opts.binaryType = (opts.binaryType || 'arraybuffer')
  var peers = []
  var uuid = cuid()
  var hub = Hub()

  function ServerPeer(server, hub, onConnect) {

    hub.subscribe('signal')
      .on('data', function(data) {
        if(data.from !== server.uuid && data.initiator){
          server.signal(data.data)
        }
      })

    server.on('signal', function(data) {
      var wrapped = Object.assign({}, {from: server.uuid}, {data})
      hub.subscribe(server.uuid)
        .on('data', function(data) {
          server.signal(data) 
        })
      hub.broadcast('signal', wrapped)
    })

    server.on('connect', function() {
      var stream = toPull.duplex(server)
      stream.address = 'rtc:'+server.remoteAddress+':'+server.remotePort
      onConnect(stream)
      peers.push(server)
      hub.close()
      hub = Hub()

      server = new SimplePeer({ wrtc })
      ServerPeer(server, hub, onConnect)
    })

  }

  return {
    name: 'rtc',
    server: function (onConnect) {
      var server = new SimplePeer({ wrtc })
      server.uuid = uuid 
  
      ServerPeer(server, hub, onConnect)
      
      return server.destroy.bind(server)
    },
    client: function (addr, cb) {
      var client = new SimplePeer({ wrtc, initiator: true })
      client.uuid = uuid

      hub.subscribe('signal')
        .on('data', function(data) {
          if(data.from !== client.uuid && !data.initiator)
            client.signal(data.data)
        })

      client.on('signal', function(data) {
        var wrapped = Object.assign({}, {from: client.uuid, initiator: true}, {data})

        hub.subscribe(client.uuid)
          .on('data', function(data) {
            client.signal(data) 
          })

        hub.broadcast('signal', wrapped)// 1
      })

      client.on('connect', function() {
        var stream = toPull.duplex(client)
        stream.address = 'rtc:'+client.remoteAddress+':'+client.remotePort
        hub.close()
        delete hub
        cb(null, stream)
      })
    },
    stringify: function () {
      var port
      if(opts.server)
        port = opts.server.address().port
      else
        port = opts.port

      return URL.format({
        protocol: 'rtc',
        slashes: true,
        hostname: opts.host || 'localhost', //detect ip address
        port: port || 3483
      })
    },
    parse: function (str) {
      var addr = URL.parse(str)
      if(!/^rtc?\:$/.test(addr.protocol)) return null
      return addr
    }
  }
}

function Hub(){
  return signalhub('sbot-rtc', [
    'localhost:9000'
  ])
}


