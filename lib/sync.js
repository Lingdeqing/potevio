const Request = require('requestretry')
const Semver = require('semver')
const Fs = require('fs')
const Path = require('path')

const {Console, Spinner} = require('./console')
const TIMEOUT = 5000

module.exports = SyncUtil
function SyncUtil(options) {
    this._options = Object.assign({}, this.defaults, options) // 配置
    this.remoteRegistry = normalizeUrl(this._options.remoteRegistry)  // 远程库地址
    this.localRegistry = normalizeUrl(this._options.localRegistry)    // 本地package库地址
    this.tarballRegistry = normalizeUrl(this._options.tarballRegistry)    // 本地tarball库地址
    this.tempDir = this._options.tempDir    // 临时目录，存放下载好的tarball

    createTempDir(this.tempDir)	// 创建临时目录

    // 包名到包的映射
    // {
    //     express: {}
    // }
    this._packages = new Map()

    // 已经处理过的包版本集合，防止出现死循环
    // [
    //     'express-1.2.1'
    // ]
    this._dealt = new Set()

    // 包名到版本链接的映射
    // {
    //     'express': {
    //         '1.2.1': 'http://registry.npmjs.org/express/-/express-0.14.0.tgz'
    //     }
    // }
    this._tarball = new Map()   // 包名到版本链接的映射
}

SyncUtil.prototype = {
    defaults: {
        remoteRegistry: 'https://registry.npmjs.org/',
        syncDependencies: true,
        syncDevDependencies: false,
        localRegistry: 'http://yaolin:123456@127.0.0.1:5984/registry/',
        tarballRegistry: 'http://yaolin:123456@127.0.0.1:5984/tarball/',
        tempDir: 'temp'
    },
    _syncPackage:async function (name, semver) {
        // 下载所有package
        // 采用层次遍历法
        const spinner = Spinner(`开始下载${name}的package及其${semver}版本的依赖`)
        var queue = [{name, semver}]
        this._markPackageDealt(name, semver)
        try{
            while (queue.length > 0){
                // console.log('本次处理包个数:'+queue.length)
                // console.log('已经缓存的包个数:'+this._packages.size)
                queue = await this.getSpecPackages(queue)
            }
        }catch (e){console.log(e)}
        spinner.succeed(`package下载完成, 成功下载的数量: ${this._packages.size}`)


        // 同步tarball
        // this._syncTarball()
    },
   syncPackage:async function (name, semver) {

        await  this._syncPackage(name, semver)

       // 同步package
       this._syncPackages()

       // 同步tarball
       this._syncTarballs()
    },
    syncPackages: async function (packages) {
        Console.green('批量下载依赖开始')
        var promises = []
        packages.forEach(({name, semver}) => {
            promises.push(this._syncPackage(name, semver))
        })
        await Promise.all(promises)
        Console.green('批量下载依赖结束')

        // 同步package
        this._syncPackages()

        // 同步tarball
        this._syncTarballs()
    },
    getSpecPackages: async function (queue) {

        var promises =queue.map(package => {
            return this.getSpecPackage(package.name, package.semver, package.parent)
        })
        var packages = await Promise.all(promises)

        var newQueue = []
        packages.forEach(({name, package, semver, parent}) => {
            if(package === null){
                console.log(`${name}【${semver}】为null${parent ? ', 依赖他的是包'+ parent.package._id +'【'+parent.semver+'】': ''}`)
            } else if(!package.versions){
                if(package && package.time && package.time.unpublished){
                    console.log(`${name}【${semver}】已经unpublished${parent ? ', 依赖他的是包'+ parent.package._id +'【'+parent.semver+'】': ''}`)
                } else {
                    console.log(`${name}【${semver}】的versions为空${parent ? ', 依赖他的是包'+ parent.package._id +'【'+parent.semver+'】': ''}`)
                }
            } else {
                var version = this.getSatisfyVersion(package, semver)   // 获取满足的版本
                this.pushDependencies(newQueue, version, {package, semver})
            }
        })
        return newQueue
    },
    getSpecPackage: async function (name, semver, parent) {
        var package = this._packages.get(name)
        if(!package){      // 本地没有，到远程库获取package
            try{
                package = await this.getPackage(name)
                this._packages.set(name, package)
            } catch (e){
                console.log(`${name}[${semver}], ${e}`)
                package = null
            }
        }


        if(package){    // 记录tarball信息
            var version = this.getSatisfyVersion(package, semver)
            if (version && version.dist && version.dist.tarball) {
                var url = version.dist.tarball.replace(/.*\//, '')
                if (url.endsWith('.tgz')) {
                    this._addToTarballMap(name, semver, version.dist.tarball)
                } else {
                    console.log('tarball不是以.tgz结尾')
                }
            } else {
                console.log('tarball字段不存在')
            }
        }

        if(package && !semver){ // 处理初始没有指定版本的包
            semver = this.getSatisfyVer(package)    // 获取最新的版本号
            this._markPackageDealt(name, semver)    // 标记该版本处理过了
        }
        return {name, package, semver, parent}
    },
    getPackage: async function (name) {
        var url = this.remoteRegistry+normalizeId(name)+'?revs=true'
        var package = await getDoc(url)
        return package
    },
    getSatisfyVer: function (package, semver) {
        if(semver){
            // 获取满足semver的最大的版本号
            var ver = null
            semver = Semver.validRange(semver)
            if (Semver.valid(semver)) {	// '1.2.1'
                ver = semver
            } else if (semver) {	// '^1.2.1'
                var versionNums = Object.keys(package.versions)
                ver = Semver.maxSatisfying(versionNums, semver)
            }
        }

        // 若没有取到版本则使用最新版本
        if (!ver) {
            var distTags = package['dist-tags']

            if (distTags && distTags.latest) {	// 如果dist-tags中有latest，则从dist-tags中取最新版本号
                ver = distTags.latest
            } else {	// 否则取versions数组的最后一个version。当然了，一般情况下dist-tags中肯定有latest字段
                var versionNums = Object.keys(package.versions)
                ver = versionNums[versionNums.length - 1]
            }
        }

        return ver
    },
    getSatisfyVersion: function (package, semver) {
        var ver = this.getSatisfyVer(package, semver)
        return package.versions[ver]
    },
    _getDependencyVersions: function (version, type) {
        if(version && version[type]){
            var dependencies = version[type]
            return Object.keys(dependencies).map(name => {
                return {
                    name: name,
                    semver: dependencies[name]
                }
            })
        }
        return []
    },
    getDevDependencyVersions: function (version) {
        return this._getDependencyVersions(version, 'devDependencies')
    },
    getDependencyVersions: function (version) {
        return this._getDependencyVersions(version, 'dependencies')
    },
    _pushDependencies: function (newQueue, dependencies, parent) {
        dependencies.forEach(({name, semver}) => {
            if(!this._hasPackageDealt(name, semver)){
                newQueue.push({name, semver, parent})
                this._markPackageDealt(name, semver)
            }
        })
    },
    pushDependencies: function (newQueue, version, parent) {
        if(this._options.syncDependencies){ // 同步依赖
            this._pushDependencies(newQueue, this.getDependencyVersions(version), parent)
        }
        if(this._options.syncDevDependencies){  // 同步开发依赖
            this._options.syncDevDependencies = false   // 开发依赖只有第一层同步
            this._pushDependencies(newQueue, this.getDevDependencyVersions(version), parent)
        }
    },
    _markPackageDealt: function (name, semver) {
        this._dealt.add(`${name}-${semver}`)
    },
    _hasPackageDealt: function (name, semver) {
        return this._dealt.has(`${name}-${semver}`)
    },
    _syncPackages: async function () {
        const spinner = Spinner(`往本地库同步package`)

        var promises = []
        this._packages.forEach((package, name) => {

            // 修改tarball
            this._setTarball(package, name)

            // 上传到本地库
            promises.push(this._createOrUpdateDoc(package, name, package._rev))
        })

        await Promise.all(promises)

        spinner.succeed('往本地库同步package成功')
    },

    _addToTarballMap: function (name, semver, url) {
        if(!this._tarball.has(name)){
            this._tarball.set(name, {})
        }
        var tarball  = this._tarball.get(name)
        tarball[semver] = url
    },

    _setTarball: function (package, name) {
        if (package && package.versions) {
            for (var v in package.versions) {
                var version = package.versions[v]
                if (version && version.dist && version.dist.tarball) {
                    version.dist._tarballOriginUrl = version.dist.tarball 	// 保存原始的tarball url
                    var tarball = version.dist.tarball.replace(/.*\//, '')
                    if (tarball.endsWith('.tgz')) {
                        version.dist.tarball = this.tarballRegistry + normalizeId(name) + '/' + tarball
                    } else {
                        console.log('tarball不是以.tgz结尾')
                    }
                } else {
                    console.log('tarball字段不存在')
                }

            }
        }
    },
    _createOrUpdateDoc: function (package, name, newRev) {
        var url = this.localRegistry + normalizeId(name)
        return createOrUpdateDoc(url, package, package._rev)
    },

    __uploadTarball: async function (tempFile, name, tarballName, rev) {
        var result = await uploadAttachment(tempFile, this.tarballRegistry+normalizeId(name), tarballName, rev)
        return result.rev || result._rev
    },
    _uploadTarball: async function (name, remoteUrl, rev) {
        var tarballName = remoteUrl.replace(/.*\//, '')
        var tempFile = Path.join(this.tempDir, tarballName)
        if(Fs.existsSync(tempFile)){	// 文件本地已存在，直接上传
            rev = await this.__uploadTarball(tempFile, name, tarballName, rev)
        } else {	// 否则重新下载上传
            rev = await new Promise((resolve, reject) => {
                Request.get(remoteUrl).pipe(Fs.createWriteStream(tempFile))	// 下载文件
                    .on('close', async (error) => {
                        if(error){
                            Console.red(`下载失败: ${error}`)
                        } else {
                            rev = await this.__uploadTarball(tempFile, name, tarballName, rev)
                            resolve(rev)
                        }
                    })
                    .on('error', function(error) {
                        Console.red(`下载失败: ${error}`)
                    })
            })
        }
        return rev
    },
    _syncTarball: async function (name, versions) {

        // 创建文档
        var url = this.tarballRegistry + normalizeId(name)
        var package
        try{
            package = await getDoc(url)
        } catch(e){
            if(e === 'not_found, missing'){ // 不存在，则新建文档
                package = await createOrUpdateDoc(url, {
                    name: name
                })
            } else {
                throw new Error('未知错误')
            }
        }

        // 获取最新的版本号
        var rev = package._rev || package.rev
        // 遍历上传所有的包
        for(var version in versions){
            try{
                rev = await this._uploadTarball(name, versions[version], rev)
            } catch (e){
                Console.red(`上传${name}-${version}过程中出错，${e}`)
                break
            }

        }
    },
    _syncTarballs: async function () {
        var promises = []
        this._tarball.forEach((versions, name) => {
            promises.push(this._syncTarball(name, versions))
        })
        await Promise.all(promises)
    }
}

/**
 * 修改url为以一个/结束
 * @param  {[type]} url [description]
 * @return {[type]}     [description]
 */
function normalizeUrl(url) {
    return url.replace(/\/*$/, '/')	// normalize
}

/**
 * 修改url为以一个/结束
 * @param  {[type]} url [description]
 * @return {[type]}     [description]
 */
function normalizeId(id) {
    return id.replace(/\//g, '%2f')	// normalize
}

/**
 * 获取文档
 * @param url
 * @returns {Promise}
 */
function getDoc(url) {
    return new Promise((resolve, reject) => {
        Request.get({
            timeout: TIMEOUT,
            url: url
        }, function (error, response, body) {
            if (error) {
                reject(error)
            } else {
                try {
                    var doc = JSON.parse(body)
                    if(doc.error){
                        reject(`${doc.error}, ${doc.reason}`)
                    } else {
                        resolve(doc)
                    }
                } catch (e) {
                    reject(e)
                }
            }
        })
    })
}

/**
 * 创建或更新文档
 * @param url
 * @param newDoc
 * @param newRev
 * @returns {Promise}
 */
function createOrUpdateDoc(url, newDoc, newRev) {
    return new Promise((resolve, reject) => {
        // 保存到库中
        // new_edits 如果发生冲突就会在文档中生成conlicts字段，理论上不会产生冲突，因为是单向同步且不会手动修改私有库数据
        // 对于同一个rev不能修改数据
        // rev由于new_edits设为了false，所以必须传rev

        if (newRev) {
            url += '?new_edits=false&rev=' + newRev	// new_edits设为false，必须要传入一个well-formed且和库中不一样的rev才会更新或添加成功
        }
        Request.put({
            timeout: TIMEOUT,
            url: url,
            json: newDoc
        }, function (error, response, body) {
            if(error){
                reject(error)
            } else {
                if(body.error){
                    reject(`${body.error}, ${body.reason}`)
                } else {
                    resolve(body)
                }
            }
        })
        // Fs.writeFile('b1.json', JSON.stringify(doc))
    })
}

/**
 * 上传附件
 * @param attachPath
 * @param url
 * @param attachName
 * @param rev
 * @returns {Promise}
 */
function uploadAttachment(attachPath, url, attachName, rev) {
    return new Promise((resolve, reject) => {
        Fs.createReadStream(attachPath).pipe(Request.put({	// 上传附件
            url: url+'/'+normalizeId(attachName),
            headers: {
                // 'Content-Type': 'application/x-compressed'
                'If-Match': rev // 必填
            }
        }, (error, response, body) => {
            if(error){
                reject(error)
            } else {
                body = JSON.parse(body)
                if(body.error){
                    reject(`${body.error}, ${body.reason}`)
                } else {
                    resolve(body)
                }
            }
        }))
    })
}
/**
 * 创建临时目录
 * @param  {[type]} dir [description]
 * @return {[type]}     [description]
 */
function createTempDir(dir) {
    if(!Fs.existsSync(dir)){
        Fs.mkdirSync(dir)
    }
}

