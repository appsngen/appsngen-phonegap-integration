(function () {
    'use strict';

    var request = require('request');
    var fs = require('fs');
    var execSync = require('child_process').execSync;
    var path = require('path');
    var archiver = require('archiver');

    var BASE_URL = 'https://build.phonegap.com/api/v1/';

    var writeIntegrationFile = function (options, callback) {
        var template, compiled;
        var viewerEndpoint = options.serviceAddress + '/viewer';
        var widgetURL = options.serviceAddress + '/viewer/content/widgets/' + options.urn +
                        '/index.html?parent=file%3A%2F%2F&token=' + encodeURIComponent(options.token);
        var widgetName = options.urn.split(':').pop();

        _.templateSettings = {
            interpolate: /\{\{(.+?)\}\}/g
        };
        try {
            template = fs.readFileSync(path.join(__dirname, './templates/integration-template.txt'), 'utf8');
            compiled = _.template(template);
            fs.writeFileSync(path.join(options.projectPath, '/www/js/integration.js'), compiled({
                widgetURL: widgetURL,
                widgetUrn: options.urn,
                widgetName: widgetName,
                viewerEndpoint: viewerEndpoint
            }));
            callback();
        } catch (error) {
            callback(error);
        }
    };

    exports.getKeys = function (accessToken, callback) {
        var url = BASE_URL + 'keys?access_token=' + accessToken;

        request.get(url, function (error, response) {
            if (error) {
                callback(error);
            }

            callback(null, JSON.parse(response.body).keys);
        });
    };

    exports.registerPhonegapApp = function (accessToken, packagePath, keys, callback) {
        var form, req;

        req = request.post(BASE_URL + 'apps?access_token=' + accessToken, function (error, response) {
            var body;

            if (error) {
                callback(error);
            }

            body = JSON.parse(response.body);
            if (response.statusCode === 201) {
                callback(null, body.id);
            } else {
                callback(body.error);
            }
        });
        form = req.form();
        form.append('data', JSON.stringify({
            title: 'temp', // required field, PhoneGap Build replace it with title from config.xml
            create_method: 'file',
            keys: keys
        }));
        form.append('file', fs.createReadStream(packagePath));
    };

    exports.createPhonegapPackage = function (projectPath, name) {
        execSync('npm run phonegap create "' + path.resolve(projectPath) + '" -- --name="' + name +
            '" --template="' + path.join(__dirname, 'templates/phonegap-template') + '"', {
            stdio: 'inherit',
            cwd: __dirname
        });
    };

    exports.generatePhonegapZipPackage = function (sourcePath, zipPath) {
        var zipPackage = archiver.create('zip');
        var output = fs.createWriteStream(zipPath);

        zipPackage.on('error', function (error) {
            throw error;
        });
        zipPackage.pipe(output);
        zipPackage.append(fs.createReadStream(path.join(sourcePath, 'config.xml')), {
            name: 'config.xml'
        });
        zipPackage.directory(path.join(sourcePath, 'www'), 'www');
        zipPackage.finalize();
    };

    exports.buildSpecificPlatform = function (appId, platform, accessToken, callback) {
        request.post(BASE_URL + 'apps/' + appId + '/' + platform + '?access_token=' + accessToken,
            function (error, resp) {
                if (error) {
                    callback(error);
                }

                if (resp.statusCode === 202) {
                    callback();
                } else {
                    callback(new Error('Unable to start build. Unexpected response from build.phonegap.com.'));
                }
            });
    };

    exports.updatePhonegapApp = function (appId, accessToken, packagePath, callback) {
        request.put(BASE_URL + 'apps/' + appId + '?access_token=' + accessToken,
            function (error, response) {
                var body, responseError;

                if (error) {
                    callback(error);
                }

                body = JSON.parse(response.body);
                switch (response.statusCode) {
                    case 401:
                        responseError = new Error('Invalid PhoneGap Id');
                        break;
                    case 404:
                        responseError = new Error(body.error);
                        break;
                    default:
                        responseError = new Error('Unknown error from build.phonegap.com');
                        break;
                }
                callback(responseError);
            })
            .form()
            .append('file', fs.createReadStream(packagePath));
    };

    exports.getDownloadLink = function (appId, platform, accessToken, callback) {
        request.get({
            url: BASE_URL + 'apps/' + appId + '/' + platform + '?access_token=' + accessToken,
            followRedirect: false
        }, function (error, response) {
            if (error) {
                callback(error);
            }

            callback(null, JSON.parse(response.body).location);
        });
    };

    // options argument required fields
    // options = {
    //      urn,
    //      port,
    //      identityToken,
    //      serviceAddress,
    //      projectPath
    // };

    exports.setIntegration = function (options, callback) {
        request.post(
            options.serviceAddress + '/rest-services/tokens/access',
            {
                body: {
                    scope: {
                        widgets: [
                            options.urn
                        ]
                    },
                    domains: [
                        'file://',
                        'http://localhost:' + options.port
                    ]
                },
                json: true,
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': 'Bearer ' + options.identityToken
                }
            },
            function (error, response) {
                if (error) {
                    callback(error);
                } else {
                    options.accessToken = response.body.accessToken;
                    writeIntegrationFile(options, callback);
                }
            }
        );
    };
})();
