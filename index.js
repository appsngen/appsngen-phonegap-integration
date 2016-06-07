(function () {
    'use strict';

    var request = require('request');
    var fs = require('fs');
    var childProcess = require('child_process');
    var path = require('path');
    var archiver = require('archiver');

    var BASE_URL = 'https://build.phonegap.com/api/v1/';

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
            var body, widgetsList;

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
            title: 'temp', //required field, PhoneGap Build replace it with title from config.xml
            create_method: 'file',
            keys: keys
        }));
        form.append('file', fs.createReadStream(packagePath));
    };

    exports.createPhonegapProject = function (projectPath, name) {
        childProcess.execSync('npm run phonegap create "' + path.resolve(projectPath) + '" -- --name="' + name +
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
})();
