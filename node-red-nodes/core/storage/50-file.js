/**
 * Copyright JS Foundation and other contributors, http://js.foundation
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 **/

module.exports = function(RED) {
    "use strict";
    var fs = require("fs-extra");
    var os = require("os");
    var path = require("path");

    function FileNode(n) {
        RED.nodes.createNode(this,n);
        this.filename = n.filename;
        this.appendNewline = n.appendNewline;
        this.overwriteFile = n.overwriteFile.toString();
        this.createDir = n.createDir || false;
        var node = this;
        node.wstream = null;
        node.data = [];

        this.on("input",function(msg) {
            var filename = node.filename || msg.filename || "";
            if (!node.filename) { node.status({fill:"grey",shape:"dot",text:filename}); }
            if (filename === "") { node.warn(RED._("file.errors.nofilename")); }
            else if (node.overwriteFile === "delete") {
                fs.unlink(filename, function (err) {
                    if (err) { node.error(RED._("file.errors.deletefail",{error:err.toString()}),msg); }
                    else if (RED.settings.verbose) { node.log(RED._("file.status.deletedfile",{file:filename})); }
                });
            }
            else if (msg.hasOwnProperty("payload") && (typeof msg.payload !== "undefined")) {
                var dir = path.dirname(filename);
                if (node.createDir) {
                    fs.ensureDir(dir, function(err) {
                        if (err) { node.error(RED._("file.errors.createfail",{error:err.toString()}),msg); }
                    });
                }

                var data = msg.payload;
                if ((typeof data === "object") && (!Buffer.isBuffer(data))) {
                    data = JSON.stringify(data);
                }
                if (typeof data === "boolean") { data = data.toString(); }
                if (typeof data === "number") { data = data.toString(); }
                if ((this.appendNewline) && (!Buffer.isBuffer(data))) { data += os.EOL; }
                node.data.push(new Buffer.from(data));

                while (node.data.length > 0) {
                    if (this.overwriteFile === "true") {
                        if (!node.wstream) {
                            node.wstream = fs.createWriteStream(filename, { encoding:'binary', flags:'w' });
                            node.wstream.on("error", function(err) {
                                node.error(RED._("file.errors.writefail",{error:err.toString()}),msg);
                            });
                        }
                    }
                    else {
                        if (!node.wstream) {
                            node.wstream = fs.createWriteStream(filename, { encoding:'binary', flags:'a' });
                            node.wstream.on("error", function(err) {
                                node.error(RED._("file.errors.appendfail",{error:err.toString()}),msg);
                            });
                        }
                    }
                    node.wstream.write(node.data.shift());
                }
            }
        });
        this.on('close', function() {
            node.status({});
        });
    }
    RED.nodes.registerType("file",FileNode);


    function FileInNode(n) {
        RED.nodes.createNode(this,n);
        this.filename = n.filename;
        this.format = n.format;
        this.chunk = false;
        if (this.format === "lines") { this.chunk = true; }
        if (this.format === "stream") { this.chunk = true; }
        var node = this;

        this.on("input",function(msg) {
            var filename = node.filename || msg.filename || "";
            if (!node.filename) {
                node.status({fill:"grey",shape:"dot",text:filename});
            }
            if (filename === "") {
                node.warn(RED._("file.errors.nofilename"));
            }
            else {
                msg.filename = filename;
                var lines = new Buffer.from([]);
                var spare = "";
                var count = 0;
                var type = "buffer";
                var ch = "";
                if (node.format === "lines") {
                    ch = "\n";
                    type = "string";
                }
                var hwm;
                var getout = false;

                var rs = fs.createReadStream(filename)
                    .on('readable', function () {
                        var chunk;
                        var hwm = rs._readableState.highWaterMark;
                        while (null !== (chunk = rs.read())) {
                            if (node.chunk === true) {
                                getout = true;
                                if (node.format === "lines") {
                                    spare += chunk.toString();
                                    var bits = spare.split("\n");
                                    for (var i=0; i < bits.length - 1; i++) {
                                        var m = {
                                            payload:bits[i],
                                            topic:msg.topic,
                                            filename:msg.filename,
                                            parts:{index:count, ch:ch, type:type, id:msg._msgid}
                                        }
                                        count += 1;
                                        if ((chunk.length < hwm) && (bits[i+1].length === 0)) {
                                            m.parts.count = count;
                                        }
                                        node.send(m);
                                    }
                                    spare = bits[i];
                                    if (chunk.length !== hwm) { getout = false; }
                                    //console.log("LEFT",bits[i].length,bits[i]);
                                }
                                if (node.format === "stream") {
                                    var m = {
                                        payload:chunk,
                                        topic:msg.topic,
                                        filename:msg.filename,
                                        parts:{index:count, ch:ch, type:type, id:msg._msgid}
                                    }
                                    count += 1;
                                    if (chunk.length < hwm) { // last chunk is smaller that high water mark = eof
                                        getout = false;
                                        m.parts.count = count;
                                    }
                                    node.send(m);
                                }
                            }
                            else {
                                lines = Buffer.concat([lines,chunk]);
                            }
                        }
                    })
                    .on('error', function(err) {
                        node.error('Error while reading file.', msg);
                    })
                    .on('end', function() {
                        if (node.chunk === false) {
                            if (node.format === "utf8") { msg.payload = lines.toString(); }
                            else { msg.payload = lines; }
                            node.send(msg);
                        }
                        else if (getout) { // last chunk same size as high water mark - have to send empty extra packet.
                            var m = { parts:{index:count, count:count, ch:ch, type:type, id:msg._msgid} };
                            node.send(m);
                        }
                    });
            }
        });
        this.on('close', function() {
            node.status({});
        });
    }
    RED.nodes.registerType("file in",FileInNode);
}
