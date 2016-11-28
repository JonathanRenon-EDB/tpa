
//var test_data_url = "/api/v1/tpa/provider/c2b1c094-03fd-5d95-b7f3-656fc9f62d72/"
var global_cluster = null;
var width = 1000;
var height = 450;

var root = null;
var tree = d3.cluster().size([height, width-100])
        .separation(function(a, b) {
            return Math.min(5-b.depth, 1);
        });

//d3.select('.treeview').call(d3.zoom().on("zoom", zoomed));


/* Renderer */

var draw_cluster = function (cluster) {
    global_cluster = cluster;
    console.log("Cluster data:", cluster);

    d3.select('.cluster_name').text(": " + cluster.name);

    root = d3.hierarchy([cluster], multimethod().dispatch(tpa.model_class)
        .when("cluster", function(c) {
            return c.instance_set;
        })
        .when("instance", function(i) {
            return i.role_set;
        })
        .default(function(d) { return (d.length && d.length > 0) ? d: null;}
        ));

    tree(root);

    var svg = d3.select(".cluster_view")
        .append('svg')
            .attr('width', width)
            .attr('height', height);

    g = svg.append("g").attr("transform", "translate(0,0)");

    //var stratify = d3.stratify()
    //    .parentId(function(d) { return d.id.substring(0, d.id.lastIndexOf(".")); });

    var edge = g.selectAll(".edge")
        .data(root.descendants().slice(1))
        .enter().append("path")
        .attr("class", "edge")
        .attr("d", function(d) {
            var path = d3.path();
            path.moveTo(d.y, d.x);
            path.bezierCurveTo(d.parent.y+200, d.x,
                                d.y-100, d.x,
                                d.parent.y, d.parent.x);

            return path;
        });

    var node = g.selectAll(".node")
        .data(root.descendants())
        .enter().append("g")
            .attr("class", function(d) {
                return "node" + (d.children ?
                    " node--internal" : " node--leaf"); })
            .attr("transform", function(d) {
                return "translate(" + d.y +','+d.x + ")"; })
            .attr('url', function(d) {
                return d.data.url ? d.data.url : null;
            });

    // ellipse
    node.append("path")
        .classed('container_shape', true)
        .attr('d', tpa.class_method()
            .when('instance', function(d) {
                var width = 100,
                    height = 100,
                    path = d3.path(),
                    radius = width/2,
                    rect = {
                        top_left: {
                            x: -width/2,
                            y: -height/2
                        },
                        top_right: {
                            x: +width/2,
                            y: -height/2
                        },
                        bottom_right: {
                            x: +width/2,
                            y: +height/2,
                        },
                        bottom_left: {
                            x: -width/2,
                            y: +height/2
                        }
                    };

                path.moveTo(rect.top_right.x, rect.top_right.y);
                path.quadraticCurveTo(rect.top_right.x+width/2, 0,
                                    rect.bottom_right.x, rect.bottom_right.y);
                path.lineTo(rect.bottom_left.x, rect.bottom_left.y);
                path.quadraticCurveTo(rect.bottom_left.x-width/2, 0,
                                    rect.top_left.x, rect.top_left.y);
                path.lineTo(rect.top_right.x, rect.top_right.y);
                path.closePath();

                console.log(path);

                return path;
            }));

    // icon
    node.append("path")
        .classed('icon', true)
        .attr('d', tpa.class_method()
            .default(function(d) {
                var radius = 5;

                var circle = "M 0 0 " +
                    " m "+radius+", 0" +
                    " a "+radius+","+radius+" 0 1,1 "+(2*radius)+",0" +
                    " a "+radius+","+radius+" 0 1,1 "+(-2*radius)+",0";
                return circle;
            }));

    // name
    node.append("text")
        .attr("class", "name")
        .attr("dy", 3)
        .attr("x", 10)
        .attr("transform", function(d) {
            return "scale(1.2, 1.2) translate(0, -20)";
        })
        .text(function(d) {
            return d.data.name;
        });

    // class
    node.append("text")
        .attr("class", "model_class")
        .attr("dy", -3)
        .attr("x", 20)
        .attr("transform", function(d) {
            return "translate(0, 20)";
        })
        .text(function(d) {
            return tpa.model_class(d.data);
        });

};
