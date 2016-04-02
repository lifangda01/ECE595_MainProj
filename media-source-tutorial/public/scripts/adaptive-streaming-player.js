$(function () {


    var BasicPlayer = function () {
        var self = this;
        self.clusters = [];
        self.renditions = ["180", "1080"];
        self.rendition = "1080";
        self.algorithm = "BBA-0";

        function Cluster(fileUrl, rendition, byteStart, byteEnd, isInitCluster, timeStart, timeEnd) {
            this.byteStart = byteStart; //byte range start inclusive
            this.byteEnd = byteEnd; //byte range end exclusive
            this.timeStart = timeStart ? timeStart : -1; //timecode start inclusive
            this.timeEnd = timeEnd ? timeEnd : -1; //exclusive
            this.requested = false; //cluster download has started
            this.isInitCluster = isInitCluster; //is an init cluster
            this.queued = false; //cluster has been downloaded and queued to be appended to source buffer
            this.buffered = false; //cluster has been added to source buffer
            this.data = null; //cluster data from vid file

            this.fileUrl = fileUrl;
            this.rendition = rendition;
            this.requestedTime = null;
            this.queuedTime = null;
        }

        Cluster.prototype.download = function (callback) {
            this.requested = true;
            this.requestedTime = new Date().getTime();
            this._getClusterData(function () {
                self.flushBufferQueue();
                if (callback) {
                    callback();
                }
            })
        };
        Cluster.prototype._makeCacheBuster = function () {
            var text = "";
            var possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
            for (var i = 0; i < 10; i++)
                text += possible.charAt(Math.floor(Math.random() * possible.length));
            return text;
        };
        Cluster.prototype._getClusterData = function (callback, retryCount) {
            var xhr = new XMLHttpRequest();

            var vidUrl = self.sourceFile + this.rendition + '.webm';
            if (retryCount) {
                vidUrl += '?cacheBuster=' + this._makeCacheBuster();
            }
            xhr.open('GET', vidUrl, true);
            xhr.responseType = 'arraybuffer';
            xhr.timeout = 6000;
            xhr.setRequestHeader('Range', 'bytes=' + this.byteStart + '-' +
            this.byteEnd);
            xhr.send();
            var cluster = this;
            xhr.onload = function (e) {
                if (xhr.status != 206) {
                    console.err("media: Unexpected status code " + xhr.status);
                    return false;
                }
                cluster.data = new Uint8Array(xhr.response);
                cluster.queued = true;
                cluster.queuedTime = new Date().getTime();
                callback();
            };
            xhr.ontimeout = function () {
                var retryAmount = !retryCount ? 0 : retryCount;
                if (retryCount == 2) {
                    console.err("Given up downloading")
                } else {
                    cluster._getClusterData(callback, retryCount++);
                }
            }
        };
        this.clearUp = function () {
            if (self.videoElement) {
                //clear down any resources from the previous video embed if it exists
                $(self.videoElement).remove();
                delete self.mediaSource;
                delete self.sourceBuffer;
                self.clusters = [];
                self.rendition = "1080";
                self.networkSpeed = null;
                $('#factor-display').html("0.0000");
                $('#180-end').html("0.0");
                $('#180-start').html("0.0");
                $('#1080-end').html("0.0");
                $('#1080-start').html("0.0");
                $('#rendition').val("1080");
            }
        }

        this.initiate = function (sourceFile, clusterFile) {
            if (!window.MediaSource || !MediaSource.isTypeSupported('video/webm; codecs="vp8,vorbis"')) {
                self.setState("Your browser is not supported");
                return;
            }
            self.clearUp();
            self.sourceFile = sourceFile;
            self.clusterFile = clusterFile;
            self.setState("Downloading cluster file");
            self.downloadClusterData(function () {
                self.setState("Creating media source");
                //create the video element
                self.videoElement = $('<video controls></video>')[0];
                //create the media source
                self.mediaSource = new MediaSource();
                self.mediaSource.addEventListener('sourceopen', function () {
                    self.setState("Creating source buffer");
                    //when the media source is opened create the source buffer
                    self.createSourceBuffer();
                }, false);
                //append the video element to the DOM
                self.videoElement.src = window.URL.createObjectURL(self.mediaSource);
                $('#basic-player').append($(self.videoElement));
            });
        }
        this.downloadClusterData = function (callback) {
            console.log("downloadClusterData"); // Called only once on initialization
            var totalRenditions = self.renditions.length;
            var renditionsDone = 0;
            _.each(self.renditions, function (rendition) {
                var xhr = new XMLHttpRequest();

                var url = self.clusterFile + rendition + '.json';
                xhr.open('GET', url, true);
                xhr.responseType = 'json';

                xhr.send();
                xhr.onload = function (e) {
                    self.createClusters(xhr.response, rendition);
                    renditionsDone++;
                    if (renditionsDone === totalRenditions) {
                        callback();
                    }
                    console.log("downloadClusterData.onload: renditionsDone = ", renditionsDone, "totalRenditions = ", totalRenditions);
                };
            })
        }
        this.createClusters = function (rslt, rendition) {
            self.clusters.push(new Cluster(
                self.sourceFile + rendition + '.webm',
                rendition,
                rslt.init.offset,
                rslt.init.size - 1,
                true
            ));
            console.log("createClusters: byteStart, byteEnd =", rslt.init.offset, rslt.init.size - 1, "(initCluster)");
            for (var i = 0; i < rslt.media.length; i++) {
                self.clusters.push(new Cluster(
                    self.sourceFile + rendition + '.webm',
                    rendition,
                    rslt.media[i].offset,
                    rslt.media[i].offset + rslt.media[i].size - 1,
                    false,
                    rslt.media[i].timecode,
                    (i === rslt.media.length - 1) ? parseFloat(rslt.duration / 1000) : rslt.media[i + 1].timecode));
                console.log("createClusters: byteStart, byteEnd =", rslt.media[i].offset, rslt.media[i].offset + rslt.media[i].size - 1, 
                            " timetart, timeEnd =", rslt.media[i].timecode, (i === rslt.media.length - 1) ? parseFloat(rslt.duration / 1000) : rslt.media[i + 1].timecode);
            }
        }
        this.createSourceBuffer = function () {
            self.sourceBuffer = self.mediaSource.addSourceBuffer('video/webm; codecs="vp8,vorbis"');
            self.sourceBuffer.addEventListener('updateend', function () {
                self.flushBufferQueue();
            }, false);
            self.setState("Downloading clusters");
            // Make sure downloadInitCluster and downloadCurrentCluster are both triggered
            self.downloadInitCluster(self.downloadCurrentCluster);
            self.videoElement.addEventListener('timeupdate', function () {
                self.downloadUpcomingClusters();
                if (self.algorithm) {
                    self.checkBufferingSpeedNew();
                } else {
                    self.checkBufferingSpeed();
                }
                self.removePlayedClusterFromBuffer();
            }, false);
        }
        this.removePlayedClusterFromBuffer = function () {
            if (!self.sourceBuffer.updating) {
                // Remove the cluster that has been buffereed, is not initCluster and has finished
                var playedClusters = _.filter(self.clusters, function (cluster) {
                    return (cluster.buffered === true && cluster.isInitCluster === false &&
                            cluster.timeEnd < self.videoElement.currentTime)
                });
                if (playedClusters.length) {
                    _.each(playedClusters, function (cluster) {
                        cluster.buffered = false;
                        console.log("removePlayedClusterFromBuffer: removing", cluster.timeStart === -1 ? 0 : cluster.timeStart, cluster.timeEnd);
                        self.sourceBuffer.remove(cluster.timeStart === -1 ? 0 : cluster.timeStart, cluster.timeEnd);
                    })
                };
            }
        }

        this.flushBufferQueue = function () {
            if (!self.sourceBuffer.updating) {
                var initCluster = _.findWhere(self.clusters, {isInitCluster: true, rendition: self.rendition});
                // Make sure the initCluster is present in the buffer first
                if (initCluster.queued || initCluster.buffered) {
                    var bufferQueue = _.filter(self.clusters, function (cluster) {
                        return (cluster.queued === true && cluster.isInitCluster === false && cluster.rendition === self.rendition)
                    });
                    // If initCluster is not yet buffered, add it to the beginning of array
                    // This is only executed once for each rendition
                    if (!initCluster.buffered) {
                        // console.log("flushBufferQueue: buffer initCluster");
                        bufferQueue.unshift(initCluster);
                    }
                    // Buffer all queued data
                    if (bufferQueue.length) {
                        var concatData = self.concatClusterData(bufferQueue);
                        _.each(bufferQueue, function (bufferedCluster) {
                            bufferedCluster.queued = false;
                            bufferedCluster.buffered = true;
                        });
                        self.sourceBuffer.appendBuffer(concatData);
                    }
                    // _.each(bufferQueue, function (cluster) {
                    //     console.log("flushBufferQueue: cluster timeStart, timeEnd =", cluster.timeStart, cluster.timeEnd);
                    // });
                    var buf = self.sourceBuffer.buffered;
                    if (buf.length == 1) {
                        console.log("flushBufferQueue: sourceBuffer.buffered =", buf.start(0), buf.end(0));
                    }
                }
            }
        }
        this.downloadInitCluster = function (callback) {
            console.log("downloadInitCluster"); // Called every time switching rendition
            // initCluster is needed for decoding the rest of the video
            // Flush our queue of queued clusters such that the initialization cluster is always added first
            _.findWhere(self.clusters, {isInitCluster: true, rendition: self.rendition}).download(callback);
        }
        this.downloadCurrentCluster = function () {
            console.log("downloadCurrentCluster"); // Only called once after initial downloadInitCluster
            var currentClusters = _.filter(self.clusters, function (cluster) {
                // Current rendition && starting time less or equal to current play time
                return (cluster.rendition === self.rendition && cluster.timeStart <= self.videoElement.currentTime && cluster.timeEnd > self.videoElement.currentTime)
            });
            if (currentClusters.length === 1) {
                currentClusters[0].download(function () {
                    self.setState("Downloaded current cluster");
                });
            } else {
                console.err("Something went wrong with download current cluster");
            }
        }
        this.downloadUpcomingClusters = function () {
            // console.log("downloadUpcomingClusters");
            var nextClusters = _.filter(self.clusters, function (cluster) {
                // Not downloaded yet && current rendition && start time is within 5s from now
                return (cluster.requested === false && cluster.rendition === self.rendition && cluster.timeStart > self.videoElement.currentTime && cluster.timeStart <= self.videoElement.currentTime + 5)
            });
            if (nextClusters.length) {
                self.setState("Buffering ahead");
                _.each(nextClusters, function (nextCluster) {
                    nextCluster.download();
                });
            } else {
                if (_.filter(self.clusters, function (cluster) {
                        return (cluster.requested === false )
                    }).length === 0) {
                    self.setState("Finished buffering whole video");
                } else {
                    self.finished = true;
                    self.setState("Finished buffering ahead");
                }
            }
        }
        this.switchRendition = function (rendition) {
            self.rendition = rendition;
            self.downloadInitCluster();
            self.downloadUpcomingClusters();
            $('#rendition').val(rendition);
        }
        this.concatClusterData = function (clusterList) {
            var bufferArrayList = [];
            _.each(clusterList, function (cluster) {
                bufferArrayList.push(cluster.data);
            });
            var arrLength = 0;
            _.each(bufferArrayList, function (bufferArray) {
                arrLength += bufferArray.length;
            });
            var returnArray = new Uint8Array(arrLength);
            var lengthSoFar = 0;
            _.each(bufferArrayList, function (bufferArray, idx) {
                returnArray.set(bufferArray, lengthSoFar);
                lengthSoFar += bufferArray.length;
            });
            return returnArray;
        };

        this.setState = function (state) {
            $('#state-display').html(state);
        }


        this.downloadTimeMR = _.memoize(
            function (downloadedClusters) {  // map reduce function to get download time per byte
                return _.chain(downloadedClusters
                        .map(function (cluster) {
                            return {
                                size: cluster.byteEnd - cluster.byteStart,
                                time: cluster.queuedTime - cluster.requestedTime
                            };
                        })
                        .reduce(function (memo, datum) {
                            return {
                                size: memo.size + datum.size,
                                time: memo.time + datum.time
                            }
                        }, {size: 0, time: 0})
                ).value()
            }, function (downloadedClusters) {
                return downloadedClusters.length; //hash function is the length of the downloaded clusters as it should be strictly increasing
            }
        );
        this.getClustersSorted = function (rendition) {
            return _.chain(self.clusters)
                .filter(function (cluster) {
                    return (cluster.buffered === true && cluster.rendition == rendition && cluster.isInitCluster === false);
                })
                .sortBy(function (cluster) {
                    return cluster.byteStart
                })
                .value();
        }
        this.getNextCluster = function () {
            var unRequestedUpcomingClusters = _.chain(self.clusters)
                .filter(function (cluster) {
                    return (!cluster.requested && cluster.timeStart >= self.videoElement.currentTime && cluster.rendition === self.rendition);
                })
                .sortBy(function (cluster) {
                    return cluster.byteStart
                })
                .value();
            if (unRequestedUpcomingClusters.length) {
                return unRequestedUpcomingClusters[0];
            } else {
                self.setState('Completed video buffering')
                throw new Error("No more upcoming clusters");
            }
        };
        this.getPrevClusterDownloadBytesPerSecond = function () {
            var prevCluster = _.filter(self.clusters, function (cluster) {
                return (cluster.queued || cluster.buffered)
            }).slice(-1)[0];
            var res = (prevCluster.byteEnd - prevCluster.byteStart) /
                        ((prevCluster.queuedTime - prevCluster.requestedTime) / 1000);
            // console.log("getPrevClusterDownloadBytesPerSecond: prevClusterMap MB/sec =", res/1000000);
            return res;
        }
        // Calculate the accumulative speed
        this.getDownloadTimePerByte = function () {    //seconds per byte
            var mapOut = this.downloadTimeMR(_.filter(self.clusters, function (cluster) {
                return (cluster.queued || cluster.buffered)
            }));
            var res = ((mapOut.time / 1000) / mapOut.size);
            // console.log("getDownloadTimePerByte: mapOut.time, mapOut.size =", mapOut.time, mapOut.size);
            return res;
        };
        this.getNextRateFromRateMap = function () {
            // In default example video, 1080P requires ~72000 B/s, 180P requires ~22000 B/s
            var R = [20000, 70000];
            var B = [11, 19];
            var buf = self.sourceBuffer.buffered;
            var BO;
            if (buf.length == 1) {
                BO = buf.end(0) - buf.start(0);
            } else {
                BO = 0;
            }
            // Look up the piecewise ratemap function
            if (BO < B[0]) {

            } else if (BO > B[B.length-1]) {

            } else {
                
            }
        };
        this.checkBufferingSpeedNew = function () {
            var prevClusterBytesPerSecond = self.getPrevClusterDownloadBytesPerSecond();
            var nextCluster = self.getNextCluster();
            var upcomingBytesPerSecond = (nextCluster.byteEnd - nextCluster.byteStart) / (nextCluster.timeEnd - nextCluster.timeStart);
            var estimatedSecondsToDownloadPerSecondOfPlayback = secondsToDownloadPerByte * upcomingBytesPerSecond;

            var overridenFactor = self.networkSpeed ? self.networkSpeed : Math.round(estimatedSecondsToDownloadPerSecondOfPlayback * 10000) / 10000;

            $('#factor-display').html(overridenFactor);

            var lowClusters = this.getClustersSorted("180");
            if (lowClusters.length) {
                $('#180-end').html(Math.round(lowClusters[lowClusters.length - 1].timeEnd*10)/10);
                $('#180-start').html(lowClusters[0].timeStart === -1 ? "0.0" :Math.round(lowClusters[0].timeStart*10)/10);
            }

            var highClusters = this.getClustersSorted("1080");
            if (highClusters.length) {
                $('#1080-end').html(Math.round(highClusters[highClusters.length - 1].timeEnd*10)/10);
                $('#1080-start').html(highClusters[0].timeStart === -1 ? "0.0" : Math.round(highClusters[0].timeStart*10)/10);
            }

            if (overridenFactor > 0.8) {
                if (self.rendition !== "180") {
                    self.switchRendition("180")
                }
            } else {
                //do this if you want to move rendition up automatically
                //if (self.rendition !== "1080") {
                //    self.switchRendition("1080")
                //}
            }
        }
        this.checkBufferingSpeed = function () {
            var secondsToDownloadPerByte = self.getDownloadTimePerByte();
            // console.log("checkBufferingSpeed: secondsToDownloadPerByte =", secondsToDownloadPerByte);
            var nextCluster = self.getNextCluster();
            var upcomingBytesPerSecond = (nextCluster.byteEnd - nextCluster.byteStart) / (nextCluster.timeEnd - nextCluster.timeStart);
            var estimatedSecondsToDownloadPerSecondOfPlayback = secondsToDownloadPerByte * upcomingBytesPerSecond;

            var overridenFactor = self.networkSpeed ? self.networkSpeed : Math.round(estimatedSecondsToDownloadPerSecondOfPlayback * 10000) / 10000;

            $('#factor-display').html(overridenFactor);

            var lowClusters = this.getClustersSorted("180");
            if (lowClusters.length) {
                $('#180-end').html(Math.round(lowClusters[lowClusters.length - 1].timeEnd*10)/10);
                $('#180-start').html(lowClusters[0].timeStart === -1 ? "0.0" :Math.round(lowClusters[0].timeStart*10)/10);
            }

            var highClusters = this.getClustersSorted("1080");
            if (highClusters.length) {
                $('#1080-end').html(Math.round(highClusters[highClusters.length - 1].timeEnd*10)/10);
                $('#1080-start').html(highClusters[0].timeStart === -1 ? "0.0" : Math.round(highClusters[0].timeStart*10)/10);
            }

            if (overridenFactor > 0.8) {
                if (self.rendition !== "180") {
                    self.switchRendition("180")
                }
            } else {
                //do this if you want to move rendition up automatically
                //if (self.rendition !== "1080") {
                //    self.switchRendition("1080")
                //}
            }
        }


    }

    var basicPlayer = new BasicPlayer();
    window.updatePlayer = function () {
        var sourceFile = 'vidData/example';
        var clusterData = 'vidData/example';
        basicPlayer.initiate(sourceFile, clusterData);
    }
    updatePlayer();
    $('#rendition').change(function () {
        basicPlayer.switchRendition($('#rendition').val());
    });
    $('#simulate-button').click(function () {
        basicPlayer.networkSpeed = 2;
        $('#factor-display').html(2);
        $('#simulate-button').addClass('ww4-active');
    })
    $('#restart').click(function() {
        $('#simulate-button').removeClass('ww4-active');
        updatePlayer();
    });

});