
/**
 * Generate SVG diagrams from TPA clusters using d3 and the TPA API.
 */

import * as d3 from "d3";
import * as tpa from "./tpa-api";
import {scaleLinear} from "d3-scale";
import {Accumulator, sort_by_attr} from "./utils";

const MIN_NODE_HEIGHT = 20;
const MIN_NODE_WIDTH = 100;
const MAX_CIRCLE_RADIUS = MIN_NODE_HEIGHT*0.66;

const LINK_CONNECTOR_HEIGHT = 5;
const LINK_CONNECTOR_LENGTH = MIN_NODE_WIDTH;



/**
 * Display all clusters belonging to the current tenant, one at a time.
 * Displays the first cluster immediately, returns a function to cycle to
 * the next when called.
*/
export function show_clusters(viewport) {
    var clusters = [];
    var current_cluster_idx = -1;

    tpa.get_all("cluster", null, c => {
        clusters = c;

        if (clusters.length > 0) {
            current_cluster_idx = 0;
            draw_cluster(clusters[current_cluster_idx], viewport);
        }
    });

    return function next_cluster() {
        if (clusters.length < 1) {
            return;
        }

        current_cluster_idx = current_cluster_idx+1;
        if (current_cluster_idx >= clusters.length) {
            current_cluster_idx = 0;
        }
        draw_cluster(clusters[current_cluster_idx], viewport);
    };
}


export function display_cluster_by_uuid(cluster_uuid, viewport) {
    tpa.get_cluster_by_uuid(cluster_uuid, c => draw_cluster(c, viewport));
}

function setup_viewport(viewport, width, height) {
    viewport.selectAll("svg").remove();

    var svg = viewport.append('svg')
        .classed("diagram-viewport", true)
        .attr('width', width)
        .attr('height', height);

    var viewport_contents = svg.append('g');

    // Zoom

    var zoom = d3.zoom()
        //.scaleExtent([0.5, 40])
        .translateExtent([[-width/2, -height/2], [width*2, height*2]])
        .on("zoom", () => viewport_contents.attr("transform", d3.event.transform));

    svg.call(zoom);

    var diagram = viewport_contents.append("g")
        .classed("diagram", true)
        .attr('transform', `translate(0, ${height/2})`);

    return diagram;
}


function draw_background_grid(diagram, width, height) {
    var yScale = scaleLinear()
        .domain([-height, height])
        .range([-height*2, height*2]);

    var grid = diagram.append('g')
        .classed('background-grid', true)
        .selectAll("line.horizontal")
        .data(yScale.ticks(50)).enter()
        .append("line")
            .classed('horizontal', true)
            .attr("x1", -width*2)
            .attr("x2", width*2)
            .attr("y1", yScale)
            .attr("y2", yScale);

    var xAxis = d3.axisLeft(yScale);

    grid.call(xAxis);

    var xScale = scaleLinear()
        .domain([-width, width])
        .range([-width*2, width*2]);

    var gridy = diagram.append('g')
        .classed('background-grid', true)
        .selectAll("line.vertical")
        .data(xScale.ticks(50)).enter()
        .append("line")
            .classed('horizontal', true)
            .attr("y1", -height*2)
            .attr("y2", height*2)
            .attr("x1", xScale)
            .attr("x2", xScale);

    var yAxis = d3.axisTop(yScale);

    gridy.call(yAxis);

}

// TPA Diagram

function draw_cluster(cluster, viewport) {
    console.log("draw_cluster:", cluster, tpa.cluster_type(cluster));

    var bbox = viewport.node().getBoundingClientRect();
    var diagram = setup_viewport(viewport, bbox.width, bbox.height);

    var graph = null;

    if (tpa.cluster_type(cluster) == 'xl') {
        graph = build_xl_graph(cluster);
    }
    else {
        graph = build_tpa_graph(cluster);
    }

    var [objects, parent_id] = graph;
    var layout = tree_layout(objects, parent_id, bbox.width, bbox.height);
    var tree = layout.tree;
    var root = layout.root;

    var dobj_for_model = {}; // map obj url -> diagram item

    root.eachAfter(d => {
        dobj_for_model[d.data.url] = d;
    });

    var dom_context = d3.local();

    draw_background_grid(diagram, bbox.width, bbox.height);

    function draw_all_of_class(c, draw) {
        diagram.selectAll("."+c)
        .data(root.descendants().filter(tpa.is_instance(c)))
        .enter()
        .call(d => draw(d, diagram, {width: bbox.width, height: bbox.height},
                    dobj_for_model)
            .classed(c, true)
        );
    }

    draw_all_of_class('zone', draw_zone);
    draw_all_of_class('rolelink', draw_rolelink);
    draw_all_of_class('instance', draw_instance);

    d3.selectAll(".cluster_name").text(cluster.name);
}

function build_xl_graph(cluster) {
    var parent_id = {};
    var objects = [cluster];
    var gtm_instances = [];
    var coord_instances = [];
    var roles = {}; // role url -> instance

    parent_id[cluster.url] =  "";


    cluster.subnets.forEach(function(s) {
        objects.push(s);
        parent_id[s.url] = cluster.url;

        s.instances.forEach(function(i) {
            objects.push(i);

            i.roles.forEach(function(r) {
                roles[r.url] = i;
                if (r.role_type == "gtm") {
                    gtm_instances.push(i);
                    parent_id[i.url] = s.url;
                }
                if (r.role_type == "coordinator") {
                    coord_instances.push(i);
                }
            });
        });
    });

    var gtm_center = gtm_instances[Math.floor(gtm_instances.length/2)];
    var coord_center = (coord_instances.length > 0) ?
            coord_instances[Math.floor(coord_instances.length/2)]
            : gtm_center;

    cluster.subnets.forEach(s =>
        s.instances.filter(i => !(i.url in parent_id))
            .forEach(function(i) {
                i.roles.forEach(function(r) {
                    switch (r.role_type) {
                        case 'datanode-replica':
                            r.client_links.forEach(function(ln) {
                                if (ln.name == 'datanode-replica') {
                                    objects.push(ln);
                                    parent_id[ln.url] = roles[ln.server_role].url;
                                    parent_id[i.url] = ln.url;
                                }
                            });
                            break;
                        case 'coordinator':
                            r.client_links.forEach(function(ln) {
                                if (ln.name == 'gtm') {
                                    objects.push(ln);
                                    parent_id[ln.url] = roles[ln.server_role].url;
                                    parent_id[i.url] = ln.url;
                                }
                            });
                            break;
                        case 'datanode':
                            r.client_links.forEach(function(ln) {
                                if (ln.name == 'coordinator' && !(i.url in parent_id)) {
                                    objects.push(r);
                                    parent_id[r.url] = coord_center.url;
                                    parent_id[i.url] = r.url;
                                }
                            });
                            break;
                    }
                });
                if ( !(i.url in parent_id)) {
                    parent_id[i.url] = coord_center.url;
                }
        }));

    return [objects, parent_id];
}


const DG_POSTGRES_ROLES = {primary: true, replica: true};


/**
 * Returns the objects and their parents relevant to drawing a cluster
 * as a tree.
 * 
 * Cluster -> Region -> Zone -> Subnet -> Instance(root) -> 
 * (-> rolelink -> instance)*
 */
function build_tpa_graph(cluster) {
    var tree = new Tree();

    var accum = [];
    var objects = [cluster];
    var parent_id = {};
    var role_instance = {};
    var pg_instances = [];

    var zones = [];

    for(let subnet of cluster.subnets) {
        subnet.zone = tpa.url_cache[subnet.zone];
        zones.push(subnet.zone);
    }

    sort_by_attr(zones, 'name');

    for (let zone of zones) {
        accum.push([zone, cluster]);
    }

    function add_instance_parent(instance, parent) {
        accum.push([instance, parent]);
        parent_id[instance.url] = parent.url;
    }

    // Grammar:
    // cluster -> region -> zone -> (subnet?) -> instance 
    //   (-> rolelink -> instance)*

    for (let subnet of cluster.subnets) {
        for (let instance of subnet.instances) {
            if (DG_POSTGRES_ROLES[tpa.instance_role(instance).role_type]) {
                    pg_instances.push(instance);
                    instance.zone = subnet.zone;

                    // TODO this is needed until the model linker is written
                    for(let role of instance.roles) {
                        role.instance = instance;
                        role_instance[role.url] = instance;
                    }
            }
        }
    }

    sort_by_attr(pg_instances, 'name');

    let dummy_idx = 0;

    for (let client_instance of pg_instances) {
        for (let r of client_instance.roles) {
            if (!(r.role_type in DG_POSTGRES_ROLES)) continue;

            for (let client_link of r.client_links) {
                let server_instance = role_instance[client_link.server_role];
                if (client_instance == server_instance) return;

                // FIXME for drawing role!
                client_link.server_instance = role_instance[client_link.server_role];

                if (server_instance.zone != client_instance.zone) {
                    server_instance = {
                        url: `dummyparent:${dummy_idx++}`,
                        zone: client_instance.zone
                    };

                    add_instance_parent(server_instance, client_instance.zone);
                }

                if (!(client_instance.url in parent_id)) {
                    add_instance_parent(client_instance, client_link);
                }
                // set link's parent to other instance
                accum.push([client_link, server_instance]);
            }
        }
    }

    // if an instance has no parent yet, the zone is its parent.
    for(let i of pg_instances) {
        if (!(i.url in parent_id)) {
            add_instance_parent(i, i.zone);
        }
    }

    // create final parent lookup
    accum.forEach(function([o, p]) {
        if (!(o in parent_id)) {
            objects.push(o);
            parent_id[o.url] = p.url;
        }
    });

    return [objects, parent_id];
}


function draw_zone(selection, zone, size) {
    //var zone_sep_y = d3.local();

    var zone_display = selection.append('g')
        .classed('zone--empty',  d => d.children)
        .attr("transform", d => `translate(${-d.parent.x}, ${d.y})`)
        .property('model-url', d => d.data.url ? d.data.url : null);

    zone_display.append("text")
        .text(d => d.data.name);

    zone_display.append('line')
        .attr('x1', 0)
        .attr('y1', function (d) {
            return -MIN_NODE_HEIGHT*2;
        })
        .attr('x2', size.width)
        .attr('y2', function (d) {
            return -MIN_NODE_HEIGHT*2;
        });

    return zone_display;
}

function instance_size(instance) {
    return {width: MIN_NODE_WIDTH,
            height: MIN_NODE_HEIGHT};
}


function draw_instance(selection, instance) {
    var node_rect = d3.local();
    var node_model = d3.local();
    var node_url = d3.local();

    var node = selection.append("g")
        .attr("class", d => "instance node" +
            (d.children ? " node--internal" : " node--leaf"))
        .attr("transform", d => `translate(${d.x}, ${d.y})`)
        .property('model-url', d => d.data.url ? d.data.url : null)
        .each(function(d) {
            var size = instance_size(d.data);
            node_model.set(this, d.data);
            node_url.set(this, d.data.url);
            node_rect.set(this, make_rect(size.width, size.height));
        });

    // icon
    node.append("path")
        .classed('icon', true)
        .attr('d', tpa.class_method()
            .default(function(d) {
                let ns = node_rect.get(this);
                let radius = MAX_CIRCLE_RADIUS; // TODO calculate from instype
                let diameter = 2*radius;

                return "M 0 0 " +
                    ` m -${radius}, 0` +
                    ` a ${radius},${radius} 0 1,1 ${diameter},0` +
                    ` a ${radius},${radius} 0 1,1 ${diameter},0`;
            }));

    // name
    node.append("text")
        .classed("name", true)
        .attr("transform", function(d) {
            let ns = node_rect.get(this);
            return "translate("+(MAX_CIRCLE_RADIUS)+", " + 
                (-MAX_CIRCLE_RADIUS) + ")";
        })
        .text(d => d.data.name);

    return node;
}

function draw_rolelink(selection, rolelink, size, dobj_for_model) {
    return selection.append("path")
        .classed("edge", true)
        .attr("d", function(d) {
            // draw line from server instance to client instance
            if ( !d.parent || !d.children) {
                return "";
            }
            let p = dobj_for_model[d.data.server_instance.url],
                c = d.children[0];
            let path = d3.path();

            let p_y = p.y + LINK_CONNECTOR_HEIGHT * p.children.indexOf(d);
            let c_y = c.y;

            path.moveTo(p.x, p_y);
            path.lineTo(p.x+LINK_CONNECTOR_LENGTH, p_y);
            path.lineTo(c.x-LINK_CONNECTOR_LENGTH, c_y);
            path.lineTo(c.x, c_y);
            return path;
        });
}


/*********
 * View and geometry helpers.
 */

class Tree {
    constructor() {
        this.objects = [];
        this.queue = [];  // [object, parent]
        this.parent = {}; // url -> parent object
    }

    add(o, parent) {
        this.queue.push([o, parent]);
    }
}


function tree_layout(objects, parent_id, width, height) {
    var table = d3.stratify()
        .id(d=> d.url)
        .parentId(d => parent_id[d.url])
    (objects);

    var root = d3.hierarchy(table);

    var tree = d3.tree()
                .size([height, width])
                .nodeSize([height/15, MIN_NODE_WIDTH*1.5]);

    tree(root);

    var diagram_left = root.y;

    root.descendants().forEach(function(d) {
        // rotate 90 deg, assume root is not displayed
        let x = (d.y ? d.y : 0),
            y = (d.x ? d.x : 0);

        d.x = x - diagram_left;
        d.y = y;

        // remove the double-reference introduced by stratify
        d.data = d.data.data;
    });

    root.eachAfter(d => {
        if (d.children && d.children.length > 0) {
            d.y = d.children[0].y;
        }
    });


    console.log("LAYOUT -----------");
    console.log("objects:", objects);
    console.log("stratified:", table);
    console.log("root:", root);

    return {tree: tree, root: root};
}


/**
 * Returns the minimum and maximum Y values for the descendants of this
 * diagram element.
 */
function node_yspan(d) {
    return {
        min_y: d3.min(d.descendants().map(c => c.y)),
        max_y: d3.max(d.descendants().map(c => c.y+height))
    };
}


function make_rect(w, h) {
    return {
        width: w,
        height: h,
        top_left:     { x: -w/2, y: -h/2 },
        top_right:    { x: +w/2, y: -h/2 },
        bottom_right: { x: +w/2, y: +h/2 },
        bottom_left:  { x: -w/2, y: +h/2 }
    };
}



