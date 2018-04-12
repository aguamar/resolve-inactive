const fetch = require('make-fetch-happen');
const pad   = require('pad-left');
const args  = require('optimist').argv;
const readline = require('readline');
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

var queryString = [
    'limit=0',
    'include_fields=id,status,priority,product,component',
    'product=Core',
    'product=External%20Software%20Affecting%20Firefox',
    'product=Firefox&product=Firefox%20for%20Android',
    'product=Firefox%20for%20iOS',
    'product=NSPR',
    'product=NSS',
    'product=Toolkit',
    'resolution=---',
    'f1=days_elapsed',
    'f2=priority',
    'f3=bug_id',
    'o1=greaterthan',
    'o2=notequals',
    'o3=greaterthan',
    'v1=1y',
    'v2=P1',
    'v3='].join('&');

var last = 0;
var result = { bugs: [] };
var limit = sizeOfResult = 50;
var completed = 0;
var counts = {};
var changes = []; // array of updated bugs
var rejections = []; // array of bugs that didn't get updated
var host = 'https://bugzilla-dev.allizom.org';
var key = args.key || '';

function getBugs(last) {
    var newLast;
    fetch(host + '/rest/bug?' + queryString + last)
        .then(function(response) { 
            if (response.ok) {  
                response.json()
                .then(function(data) {
                    newLast = data.bugs[data.bugs.length - 1].id;
                    /* 
                        There are two ways we can fall out of this recursion: if the total
                        number of bugs is evenly divisible by limit (edge case) then we'll 
                        err on fetching a result set twice, but not adding it, or if the number
                        of bugs in the batch returned is less than the limit, we'll add the last
                        batch and stop 
                    */
                    if (newLast != last) {
                        completed ++;
                        console.log(`Completed ${completed} fetches.`);
                        console.log(`Found ${data.bugs.length} bugs this request`)
                        Array.prototype.push.apply(result.bugs, data.bugs); // call push on each result.bugs
                        if (data.bugs.length === limit) {
                            console.log(`calling again with last=${newLast}`);
                            complete(); // temp
                            getBugs(newLast); // recursively call using the id of the last bug in the results as last                               
                        } else {
                            console.log("less bugs than limit");
                            complete();
                        }
                    } else {
                        console.log("edge case");
                        complete();
                    }
                });
            }
        });
}

function complete() {
    console.log(`Found ${result.bugs.length} bugs to update.`);

    // roll up for reporting
    result.bugs.forEach((bug, i) => {
        if (counts[bug.status]) {
            if (counts[bug.status][bug.priority]) {
                counts[bug.status][bug.priority] ++;
            }
            else {
                counts[bug.status][bug.priority] = 1;
            }
        } else {
            counts[bug.status] = {};
            counts[bug.status][bug.priority] = 1;
        }
    });

    // TODO: product/component counts

    print(counts);

    // Ask to continue
    rl.question('Do you wish to RESOLVE these bugs as INACTIVE? (y/N): ', answer => {
        if (answer.toLowerCase() === 'y') {
            resolve(result.bugs);
        } else {
            process.exit(0);
        }
    });
}

function print(counts) {
    totalByPriority = [0, 0, 0, 0, 0, 0, 0];
    console.log(['status','--','P1','P2','P3','P4','P5', 'totals'].reduce((pre, cur) => {
        return pre + pad(cur, 12, ' ');
    },''));
    Object.keys(counts).sort().forEach(status => {
        var none, p1, p2, p3, p4, p5;
        none = counts[status]['--'] || 0;
        p1   = counts[status]['P1'] || 0;
        p2   = counts[status]['P2'] || 0;
        p3   = counts[status]['P3'] || 0;
        p4   = counts[status]['P4'] || 0;
        p5   = counts[status]['P5'] || 0;
        all  = p1 + p2 + p3 + p4 + p5 + none;
        totalByPriority[0] += none;
        totalByPriority[1] += p1;
        totalByPriority[2] += p2;
        totalByPriority[3] += p3;
        totalByPriority[4] += p4;
        totalByPriority[5] += p5;
        totalByPriority[6] += all;
        console.log([status, none, p1, p2, p3, p4, p5, all].reduce((pre, cur) => {
            return pre + pad(cur, 12, ' ');
        }, ''));
    });
    totalByPriority.unshift('All'); // extra step because unshift doesn't return the array
    console.log(totalByPriority.reduce((pre, cur) => {
        return pre + pad(cur, 12, '');
    },''));
}

function resolve(bugs) {
    var i = 0, requestBody, tranche, trancheSize = 100, requests = [];

    while (bugs.length > i*trancheSize && i < 5) {
        i++;
        tranche = bugs.slice((i - 1)*trancheSize, i*trancheSize).map(bug => { return bug.id });
        requestBody = JSON.stringify({
            ids: tranche,
            status: 'RESOLVED',
            resolution: 'INACTIVE',
            comment: {
                body: 'Bulk move of bugs to inactive status.'
            }
        });
        requests.push(fetch(host + '/rest/bug/' + tranche[0], 
            {
                method: 'PUT', 
                body: requestBody,
                headers: {
                    'x-bugzilla-api-key': key,
                    'Content-Type': 'application/json' 
                },
                redirect: 'follow'
            })
            .then(res => {return res.json() })
            .then(body => {
                console.log(body);
                body.bugs.forEach(bug => {
                    if (bug.changes) {
                        changes.push(bug.id);
                    }
                    else {
                        rejections.push(bug.id);
                    }
                });
            })
            .catch(err => {
                Array.prototype.push.apply(rejections, tranche);
            })
        );
    }
    console.log(`Submitted ${i} tranches of ${trancheSize} bugs to update.`);

    Promise.all(requests).then(function() {
        console.log(`Updated ${changes.length} bugs.`);
        console.log(`Rejected ${rejections.length} bugs.`);
        process.exit(1);
    });
}

if (key === '') {
    console.error('Bugzilla API key required: --key');
    process.exit(0);
}

getBugs();
